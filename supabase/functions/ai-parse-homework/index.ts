// ═══════════════════════════════════════════════════════════════════════════
// AI-PARSE-HOMEWORK — استخراج الأسئلة من ملف (صورة/PDF) بواجهة Vision
// Task 44: المدرس يرفع ملف أسئلة → الدالة تحاول تفهمه وترجّع الأسئلة
// بإجاباتها كـ JSON جاهز للمراجعة والإضافة للواجب.
//
// auth: verify_jwt = true (المدرس المسجّل فقط).
// Providers (أول مفتاح موجود يشتغل):
//   GEMINI_API_KEY  → Google Gemini (vision، مفضّل — رخيص وسريع)
//   OPENAI_API_KEY  → OpenAI gpt-4o-mini (vision)
// لو مفيش مفتاح: 501 + رسالة عربية واضحة (النص الملصوق شغال من غير AI
// عبر المحلّل المحلي في src/lib/hwQuiz.js).
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_BASE64_BYTES = 10 * 1024 * 1024

const PROMPT = `أنت مساعد متخصص في قراءة أوراق الأسئلة المدرسية العربية والإنجليزية.
استخرج كل الأسئلة الاختيارية من الملف المرفق وأرجع JSON فقط بدون أي شرح.

المطلوب لكل سؤال:
- question_text: نص السؤال كما هو، أو null إذا كان السؤال غير مكتوب (ورقة إجابات فقط)
- kind: "mcq" للاختيار من متعدد، أو "true_false" للسؤال الصح/الغلط
- options: مصفوفة نصوص الخيارات (2 إلى 6). لسؤال صح/غلط: ["صح","غلط"]
- correct_options: مصفوفة بإجابة/إجابات صحيحة — بنفس نصوص options بالظبط (مثل ["القاهرة"]) أو ["صح"]/["غلط"]
- explanation: شرح قصير إذا ظاهر في الورقة وإلا null

قواعد:
- إذا لم تظهر الإجابة الصحيحة في الورقة اجعل correct_options مصفوفة فارغة []
- لا تخترع أسئلة غير موجودة، ولا تفقد أي سؤال موجود
- حافظ على النص الأصلي (العربي كما هو) وترقيم الأسئلة حسب الترتيب

أرجع بهذا الشكل فقط:
{"questions":[{"question_text":"...","kind":"mcq","options":["..."],"correct_options":["..."],"explanation":null}]}`

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function callGemini(apiKey, base64, mime) {
  const model = 'gemini-2.0-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`gemini_http_${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  return text
}

async function callOpenAI(apiKey, base64, mime) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`openai_http_${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ''
}

function extractJson(text) {
  if (!text) return null
  let t = String(text).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const startArr = t.indexOf('[')
  const from = startArr >= 0 && (startArr < start || start < 0) ? startArr : start
  if (from < 0) return null
  const end = t.lastIndexOf('}')
  const endArr = t.lastIndexOf(']')
  const to = Math.max(end, endArr)
  if (to <= from) return null
  try { return JSON.parse(t.slice(from, to + 1)) } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body
  try { body = await req.json() } catch { return json(400, { error: 'invalid_json' }) }

  const base64 = String(body?.file_base64 || '')
  const mime = String(body?.mime || 'image/jpeg')
  if (!base64) return json(400, { error: 'missing_file', message: 'ابعت file_base64' })
  if (base64.length > MAX_BASE64_BYTES) return json(413, { error: 'file_too_large', message: 'الملف كبير جدًا — الحد 8 ميجا تقريبًا' })

  // PDF مدعوم على Gemini فقط (OpenAI vision صور)
  const isPdf = mime === 'application/pdf'
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')

  try {
    let raw = null
    if (geminiKey) {
      raw = await callGemini(geminiKey, base64, mime)
    } else if (openaiKey && !isPdf) {
      raw = await callOpenAI(openaiKey, base64, mime.startsWith('image/') ? mime : 'image/jpeg')
    } else if (openaiKey && isPdf) {
      return json(501, { error: 'pdf_needs_gemini', message: 'ملفات PDF محتاجة GEMINI_API_KEY على السيرفر — أو حوّل الصفحات صور وارفعها' })
    } else {
      return json(501, {
        error: 'ai_key_missing',
        message: 'فهم الصور والملفات محتاج مفتاح AI على سيرفر النظام. ضيف GEMINI_API_KEY (أو OPENAI_API_KEY) من إعدادات Supabase ثم أعد المحاولة. لحد ساعتها: الصق نص الأسئلة في نفس الشاشة — المحلّل النصي شغال من غير AI.',
      })
    }

    const parsed = extractJson(raw)
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : Array.isArray(parsed) ? parsed : []
    if (!questions.length) {
      return json(422, { error: 'no_questions_found', message: 'مقدرتش أطلع أسئلة من الملف — جرّب صورة أوضح أو اكتب الأسئلة يدويًا' })
    }
    return json(200, { ok: true, questions, warnings: [] })
  } catch (err) {
    console.error('ai-parse-homework error:', err)
    return json(502, { error: 'ai_provider_failed', message: 'مزوّد الـ AI رجّع خطأ — جرّب تاني أو استخدم النص الملصوق', detail: String(err?.message || err).slice(0, 300) })
  }
})
