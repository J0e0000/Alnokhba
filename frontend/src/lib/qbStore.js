// lib/qbStore.js
// All Supabase CRUD for Nokhba QB. Every function takes the supabase client
// as the first arg so this module is testable and decoupled from the singleton.

const QUESTIONS_TABLE = 'qb_questions'
const TAGS_TABLE = 'qb_tags'
const QT_TABLE = 'qb_question_tags'
const EXAMS_TABLE = 'qb_exams'
const SECTIONS_TABLE = 'qb_exam_sections'
const ITEMS_TABLE = 'qb_exam_items'
const VERSIONS_TABLE = 'qb_versions'
const VERSION_ITEMS_TABLE = 'qb_version_items'
const TEMPLATES_TABLE = 'qb_templates'
const STAGING_TABLE = 'qb_import_staging'

// ============================================================================
// QUESTIONS
// ============================================================================

export async function listQuestions(supabase, teacherId, filters = {}) {
  let q = supabase.from(QUESTIONS_TABLE).select('*').eq('teacher_id', teacherId)
  if (filters.subject) q = q.eq('subject', filters.subject)
  if (filters.grade) q = q.eq('grade', filters.grade)
  if (filters.unit) q = q.eq('unit', filters.unit)
  if (filters.difficulty) q = q.eq('difficulty', filters.difficulty)
  if (filters.type) q = q.eq('type', filters.type)
  if (filters.topic) q = q.ilike('topic', `%${filters.topic}%`)
  if (filters.favorite_only) q = q.eq('is_favorite', true)
  if (filters.search) {
    q = q.or(`question_text.ilike.%${filters.search}%,explanation.ilike.%${filters.search}%,source_ref.ilike.%${filters.search}%`)
  }
  q = q.order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getQuestion(supabase, id) {
  const { data, error } = await supabase.from(QUESTIONS_TABLE).select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createQuestion(supabase, teacherId, payload) {
  const row = {
    teacher_id: teacherId,
    subject: payload.subject || 'عام',
    grade: payload.grade || null,
    unit: payload.unit || null,
    lesson: payload.lesson || null,
    topic: payload.topic || null,
    difficulty: payload.difficulty || 'medium',
    type: payload.type || 'mcq',
    question_text: payload.question_text || '',
    image_url: payload.image_url || null,
    diagram_url: payload.diagram_url || null,
    choices: payload.choices || [],
    correct_answer: payload.correct_answer || {},
    explanation: payload.explanation || null,
    marks: payload.marks ?? 1,
    source_ref: payload.source_ref || null,
    is_favorite: !!payload.is_favorite,
  }
  const { data, error } = await supabase.from(QUESTIONS_TABLE).insert(row).select().single()
  if (error) throw error

  // Attach tags if provided
  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    await setQuestionTags(supabase, data.id, teacherId, payload.tags)
  }
  return data
}

export async function updateQuestion(supabase, id, patch) {
  const { data, error } = await supabase.from(QUESTIONS_TABLE).update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteQuestion(supabase, id) {
  const { error } = await supabase.from(QUESTIONS_TABLE).delete().eq('id', id)
  if (error) throw error
  return true
}

export async function duplicateQuestion(supabase, id) {
  const orig = await getQuestion(supaseSafe(supabase), id)
  const { id: _omit, created_at, updated_at, usage_count, ...rest } = orig
  const copy = { ...rest, question_text: `${orig.question_text} (نسخة)` }
  const { data, error } = await supabase.from(QUESTIONS_TABLE).insert(copy).select().single()
  if (error) throw error
  return data
}

// Helper: avoid passing undefined supabase in duplicate path
function supaseSafe(s) { return s }

export async function toggleFavorite(supabase, id, current) {
  return updateQuestion(supabase, id, { is_favorite: !current })
}

export async function incrementUsage(supabase, ids) {
  if (!ids?.length) return
  // Atomic-ish: read then write. Acceptable for low-frequency exam-save flow.
  const { data } = await supabase.from(QUESTIONS_TABLE).select('id, usage_count').in('id', ids)
  if (!data) return
  for (const q of data) {
    await supabase.from(QUESTIONS_TABLE).update({ usage_count: (q.usage_count || 0) + 1 }).eq('id', q.id)
  }
}

// ============================================================================
// TAGS
// ============================================================================

export async function listTags(supabase, teacherId) {
  const { data, error } = await supabase
    .from(TAGS_TABLE)
    .select('id, name')
    .eq('teacher_id', teacherId)
    .order('name')
  if (error) throw error
  return data || []
}

export async function ensureTags(supabase, teacherId, names) {
  // Ensure all tag names exist for this teacher, return [{id, name}] for the requested set.
  const cleaned = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))]
  if (cleaned.length === 0) return []
  // Try inserting each (idempotent via unique constraint)
  const existing = await listTags(supabase, teacherId)
  const existingMap = new Map(existing.map((t) => [t.name, t.id]))
  const result = []
  for (const name of cleaned) {
    if (existingMap.has(name)) {
      result.push({ id: existingMap.get(name), name })
      continue
    }
    const { data, error } = await supabase
      .from(TAGS_TABLE)
      .insert({ teacher_id: teacherId, name })
      .select('id, name')
      .single()
    if (!error && data) result.push(data)
  }
  return result
}

export async function getQuestionTags(supabase, questionId) {
  const { data, error } = await supabase
    .from(QT_TABLE)
    .select('tag_id, qb_tags(name)')
    .eq('question_id', questionId)
  if (error) throw error
  return (data || []).map((r) => ({ id: r.tag_id, name: r.qb_tags?.name }))
}

export async function setQuestionTags(supabase, questionId, teacherId, tagNames) {
  // Replace all tags for this question
  await supabase.from(QT_TABLE).delete().eq('question_id', questionId)
  const tags = await ensureTags(supabase, teacherId, tagNames)
  if (tags.length === 0) return []
  const rows = tags.map((t) => ({ question_id: questionId, tag_id: t.id }))
  const { error } = await supabase.from(QT_TABLE).insert(rows)
  if (error) throw error
  return tags
}

// ============================================================================
// EXAMS
// ============================================================================

export async function listExams(supabase, teacherId) {
  const { data, error } = await supabase
    .from(EXAMS_TABLE)
    .select(`
      id, title, subject, grade, total_marks, design, created_at, updated_at,
      qb_exam_sections(id, title, total_marks, order_idx, qb_exam_items(id))
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getExamFull(supabase, examId) {
  const { data: exam, error: e1 } = await supabase
    .from(EXAMS_TABLE).select('*').eq('id', examId).single()
  if (e1) throw e1

  const { data: sections, error: e2 } = await supabase
    .from(SECTIONS_TABLE).select('*').eq('exam_id', examId).order('order_idx')
  if (e2) throw e2

  const sectionIds = (sections || []).map((s) => s.id)
  let items = []
  if (sectionIds.length > 0) {
    const { data: it, error: e3 } = await supabase
      .from(ITEMS_TABLE)
      .select('*, qb_questions(*)')
      .in('section_id', sectionIds)
      .order('order_idx')
    if (e3) throw e3
    items = it || []
  }

  const { data: versions, error: e4 } = await supabase
    .from(VERSIONS_TABLE).select('*').eq('exam_id', examId).order('created_at')
  if (e4) throw e4

  return {
    exam,
    sections: sections || [],
    items: items || [],
    versions: versions || [],
  }
}

export async function saveExam(supabase, teacherId, payload) {
  // payload: { id?, title, subject?, grade?, instructions?, header?, footer?, design?, sections: [{id?, title, instructions?, items: [{question_id, marks}]}] }
  const examRow = {
    teacher_id: teacherId,
    title: payload.title,
    subject: payload.subject || null,
    grade: payload.grade || null,
    instructions: payload.instructions || null,
    header: payload.header || {},
    footer: payload.footer || null,
    design: payload.design || {},
  }

  let examId = payload.id
  if (examId) {
    const { data, error } = await supabase
      .from(EXAMS_TABLE).update(examRow).eq('id', examId).select().single()
    if (error) throw error
    // Wipe existing sections + items (cascade handles items)
    await supabase.from(SECTIONS_TABLE).delete().eq('exam_id', examId)
  } else {
    const { data, error } = await supabase
      .from(EXAMS_TABLE).insert(examRow).select().single()
    if (error) throw error
    examId = data.id
  }

  let totalMarks = 0
  for (let i = 0; i < payload.sections.length; i++) {
    const sec = payload.sections[i]
    const secRow = {
      exam_id: examId,
      title: sec.title,
      instructions: sec.instructions || null,
      order_idx: i,
      total_marks: 0,
    }
    const { data: insertedSec, error: eSec } = await supabase
      .from(SECTIONS_TABLE).insert(secRow).select().single()
    if (eSec) throw eSec

    let secTotal = 0
    for (let j = 0; j < sec.items.length; j++) {
      const it = sec.items[j]
      const marks = Number(it.marks) || 0
      secTotal += marks
      const { error: eItem } = await supabase.from(ITEMS_TABLE).insert({
        section_id: insertedSec.id,
        question_id: it.question_id,
        order_idx: j,
        marks,
      })
      if (eItem) throw eItem
    }

    await supabase.from(SECTIONS_TABLE).update({ total_marks: secTotal }).eq('id', insertedSec.id)
    totalMarks += secTotal
  }

  await supabase.from(EXAMS_TABLE).update({ total_marks: totalMarks }).eq('id', examId)

  // Bump usage_count on every question that was used
  const usedQids = payload.sections.flatMap((s) => s.items.map((it) => it.question_id))
  if (usedQids.length > 0) await incrementUsage(supabase, usedQids)

  return { id: examId, total_marks: totalMarks }
}

export async function deleteExam(supabase, examId) {
  const { error } = await supabase.from(EXAMS_TABLE).delete().eq('id', examId)
  if (error) throw error
  return true
}

// ============================================================================
// VERSIONS (A/B/C)
// ============================================================================

export async function createVersion(supabase, examId, label, opts) {
  // opts: { shuffle_questions, shuffle_choices }
  const { data: ver, error } = await supabase
    .from(VERSIONS_TABLE)
    .insert({
      exam_id: examId,
      version_label: label,
      shuffle_questions: !!opts.shuffle_questions,
      shuffle_choices: !!opts.shuffle_choices,
    })
    .select()
    .single()
  if (error) throw error

  // Load full exam to get the flat item list
  const full = await getExamFull(supabase, examId)
  const flat = []
  for (const sec of full.sections) {
    const secItems = full.items.filter((it) => it.section_id === sec.id)
    for (const it of secItems) {
      flat.push({
        section_id: sec.id,
        question_id: it.question_id,
        question: it.qb_questions,
      })
    }
  }

  const { buildVersionItems } = await import('./qbRandomize')
  const versionItems = buildVersionItems(flat, {
    shuffle_questions: ver.shuffle_questions,
    shuffle_choices: ver.shuffle_choices,
  })

  if (versionItems.length > 0) {
    const rows = versionItems.map((vi) => ({
      version_id: ver.id,
      question_id: vi.question_id,
      order_idx: vi.order_idx,
      choice_order: vi.choice_order,
    }))
    const { error: eInsert } = await supabase.from(VERSION_ITEMS_TABLE).insert(rows)
    if (eInsert) throw eInsert
  }

  return ver
}

export async function listVersions(supabase, examId) {
  const { data, error } = await supabase
    .from(VERSIONS_TABLE)
    .select('*')
    .eq('exam_id', examId)
    .order('created_at')
  if (error) throw error
  return data || []
}

export async function getVersionItems(supabase, versionId) {
  const { data, error } = await supabase
    .from(VERSION_ITEMS_TABLE)
    .select('*, qb_questions(*)')
    .eq('version_id', versionId)
    .order('order_idx')
  if (error) throw error
  return data || []
}

// ============================================================================
// TEMPLATES (saved designs)
// ============================================================================

export async function listTemplates(supabase, teacherId) {
  const { data, error } = await supabase
    .from(TEMPLATES_TABLE)
    .select('*')
    .eq('teacher_id', teacherId)
    .order('name')
  if (error) throw error
  return data || []
}

export async function saveTemplate(supabase, teacherId, name, design) {
  const { data, error } = await supabase
    .from(TEMPLATES_TABLE)
    .upsert({ teacher_id: teacherId, name, design }, { onConflict: 'teacher_id,name' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTemplate(supabase, id) {
  const { error } = await supabase.from(TEMPLATES_TABLE).delete().eq('id', id)
  if (error) throw error
  return true
}

// ============================================================================
// IMPORT STAGING
// ============================================================================

export async function createStaging(supabase, teacherId, sourceKind, rawPayload, parsedQuestions) {
  const { data, error } = await supabase
    .from(STAGING_TABLE)
    .insert({
      teacher_id: teacherId,
      source_kind: sourceKind,
      raw_payload: rawPayload,
      parsed_questions: parsedQuestions,
      status: 'pending',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listStaging(supabase, teacherId) {
  const { data, error } = await supabase
    .from(STAGING_TABLE)
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function updateStagingParsed(supabase, id, parsedQuestions) {
  const { data, error } = await supabase
    .from(STAGING_TABLE)
    .update({ parsed_questions: parsedQuestions })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function promoteStaging(supabase, id) {
  // Use the SQL function for atomicity
  const { data, error } = await supabase.rpc('qb_promote_import', { staging_id: id })
  if (error) throw error
  return data
}

export async function deleteStaging(supabase, id) {
  const { error } = await supabase.from(STAGING_TABLE).delete().eq('id', id)
  if (error) throw error
  return true
}

export async function updateStagingStatus(supabase, id, status) {
  const { error } = await supabase.from(STAGING_TABLE).update({ status }).eq('id', id)
  if (error) throw error
  return true
}
