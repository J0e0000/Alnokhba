// كل جملة: الكلمات (بالنسخة الغلط اللي بتتعرض للطالب)، فهرس الكلمة الغلط، والصورة الصحيحة للتغذية الراجعة
// الأخطاء كلها بفرق في الحروف الظاهرة (مش بس التشكيل) عشان تبان من غير تشكيل

export const MISTAKE_SENTENCES = [
  { words: ['ذهبت', 'الفتاة', 'إلى', 'المدرسه', 'باكرًا'], wrongIndex: 3, correctWord: 'المدرسة' },
  { words: ['قرأ', 'الطالب', 'قصه', 'جميلة'], wrongIndex: 2, correctWord: 'قصة' },
  { words: ['لعب', 'الأولاد', 'فى', 'الحديقة'], wrongIndex: 2, correctWord: 'في' },
  { words: ['يحب', 'المعلم', 'طلابة', 'المجتهدين'], wrongIndex: 2, correctWord: 'طلابه' },
  { words: ['سافر', 'ابي', 'إلى', 'القاهرة', 'أمس'], wrongIndex: 1, correctWord: 'أبي' },
  { words: ['ان', 'الله', 'يحب', 'المحسنين'], wrongIndex: 0, correctWord: 'إن' },
  { words: ['الشمس', 'ساطع', 'في', 'الصباح'], wrongIndex: 1, correctWord: 'ساطعة' },
  { words: ['الجو', 'باردة', 'اليوم'], wrongIndex: 1, correctWord: 'بارد' },
  { words: ['البنات', 'مجتهدون', 'في', 'دراستهن'], wrongIndex: 1, correctWord: 'مجتهدات' },
  { words: ['الأولاد', 'مجتهدات', 'في', 'دراستهم'], wrongIndex: 1, correctWord: 'مجتهدون' },
  { words: ['هذه', 'حقيبة', 'مدرسيه', 'جديدة'], wrongIndex: 2, correctWord: 'مدرسية' },
  { words: ['كتبت', 'المعلمه', 'الدرس', 'على', 'السبورة'], wrongIndex: 1, correctWord: 'المعلمة' },
  { words: ['فى', 'الحديقة', 'أشجار', 'كثيرة'], wrongIndex: 0, correctWord: 'في' },
  { words: ['هؤلاء', 'الطلاب', 'متفوقين'], wrongIndex: 2, correctWord: 'متفوقون' },
  { words: ['المهندسين', 'يبنون', 'العمارات'], wrongIndex: 0, correctWord: 'المهندسون' },
  { words: ['أنتِ', 'طالب', 'مجتهدة'], wrongIndex: 1, correctWord: 'طالبة' },
  { words: ['هاتان', 'طالبتان', 'مجتهدتين'], wrongIndex: 2, correctWord: 'مجتهدتان' },
  { words: ['نجح', 'الطلاب', 'الذين', 'اجتهدو'], wrongIndex: 3, correctWord: 'اجتهدوا' },
  { words: ['لعبو', 'كرة', 'القدم', 'مساءً'], wrongIndex: 0, correctWord: 'لعبوا' },
  { words: ['كافأ', 'المعلم', 'التلاميذ', 'الذين', 'نجحو'], wrongIndex: 4, correctWord: 'نجحوا' },
]

// خلط عشوائي بدون تكرار متتالي لنفس الترتيب
export function shuffledDeck() {
  const arr = [...MISTAKE_SENTENCES]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
