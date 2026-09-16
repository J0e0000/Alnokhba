// lib/qbLabels.js
// Centralized label system for Nokhba QB.
// All user-facing strings in QB components MUST come from here.
// Internal code identifiers (table names, function names, file names) NEVER appear in the UI.
//
// Usage:
//   import { L } from '../lib/qbLabels'
//   const txt = L('question_bank', isArabic)   // → 'بنك الأسئلة' or 'Question Bank'
//
// Or via the hook helper:
//   import { useQbLabels } from '../lib/qbLabels'
//   const { L } = useQbLabels(isArabic)
//   <button>{L('save_exam')}</button>

export const QB_LABELS = {
  // ── Navigation / section ──
  nav_qb:                       { ar: 'بنك الأسئلة',                  en: 'Question Bank' },
  section_title:                { ar: 'بنك الأسئلة ومنشئ الامتحانات',  en: 'Question Bank & Exam Builder' },
  section_tagline:              { ar: 'من المادة حتى الامتحان القابل للطباعة ومفتاح الإجابات', en: 'From source material to printable exam and answer key' },

  // ── Question Bank ──
  question_bank:                { ar: 'بنك الأسئلة',                  en: 'Question Bank' },
  new_question:                 { ar: 'سؤال جديد',                    en: 'New Question' },
  edit_question:                { ar: 'تعديل السؤال',                 en: 'Edit Question' },
  add_question:                 { ar: 'إضافة سؤال',                   en: 'Add Question' },
  delete_question:              { ar: 'حذف السؤال',                   en: 'Delete Question' },
  duplicate_question:           { ar: 'نسخ السؤال',                   en: 'Duplicate Question' },
  import_questions:             { ar: 'استيراد أسئلة',                en: 'Import Questions' },
  search_placeholder:           { ar: 'بحث في النص/الشرح',            en: 'Search text/explanation' },
  no_questions_yet:             { ar: 'لا توجد أسئلة بعد.',           en: 'No questions yet.' },
  no_questions_hint:            { ar: 'ابدأ بإضافة أسئلة لبنك الأسئلة، أو استورد من ملف PDF/صورة', en: 'Start by adding questions to the bank, or import from PDF/image' },
  favorites_only:               { ar: '⭐ المفضلة فقط',               en: '⭐ Favorites only' },
  all_difficulties:             { ar: 'كل الصعوبات',                  en: 'All difficulties' },
  all_types:                    { ar: 'كل الأنواع',                   en: 'All types' },
  all_subjects:                 { ar: 'كل المواد',                    en: 'All subjects' },
  all_grades:                   { ar: 'كل الصفوف',                    en: 'All grades' },
  question_count:               { ar: 'سؤال',                         en: 'questions' },
  marks_label:                  { ar: 'درجة',                         en: 'marks' },
  used_times:                   { ar: 'استخدم',                       en: 'used' },

  // ── Question types (human labels) ──
  type_mcq:                     { ar: 'اختيار من متعدد',              en: 'Multiple Choice' },
  type_true_false:              { ar: 'صح / خطأ',                     en: 'True / False' },
  type_short_answer:            { ar: 'إجابة قصيرة',                  en: 'Short Answer' },
  type_essay:                   { ar: 'مقال',                         en: 'Essay' },
  type_numerical:               { ar: 'رقمية',                        en: 'Numerical' },
  type_matching:                { ar: 'توصيل',                        en: 'Matching' },
  type_custom:                  { ar: 'مخصص',                         en: 'Custom' },

  // ── Difficulties ──
  diff_easy:                    { ar: 'سهل',                          en: 'Easy' },
  diff_medium:                  { ar: 'متوسط',                        en: 'Medium' },
  diff_hard:                    { ar: 'صعب',                          en: 'Hard' },

  // ── Question editor ──
  question_type:                { ar: 'نوع السؤال',                   en: 'Question Type' },
  difficulty:                   { ar: 'الصعوبة',                      en: 'Difficulty' },
  subject:                      { ar: 'المادة',                       en: 'Subject' },
  grade:                        { ar: 'الصف',                         en: 'Grade' },
  unit:                         { ar: 'الوحدة',                       en: 'Unit' },
  lesson:                       { ar: 'الدرس',                        en: 'Lesson' },
  topic:                        { ar: 'الموضوع',                      en: 'Topic' },
  question_text:                { ar: 'نص السؤال',                    en: 'Question Text' },
  question_text_required:       { ar: 'نص السؤال مطلوب',              en: 'Question text is required' },
  image_optional:               { ar: 'صورة (اختياري)',               en: 'Image (optional)' },
  remove_image:                 { ar: 'إزالة',                        en: 'Remove' },
  choices_label:                { ar: 'الاختيارات (اضغط على الدائرة للاختيار الصحيح)', en: 'Choices (click circle to mark correct)' },
  add_choice:                   { ar: 'إضافة اختيار',                 en: 'Add choice' },
  at_least_2_choices:           { ar: 'اختياران على الأقل',           en: 'At least 2 choices' },
  correct_answer:               { ar: 'الإجابة الصحيحة',              en: 'Correct Answer' },
  true_label:                   { ar: 'صح',                           en: 'True' },
  false_label:                  { ar: 'خطأ',                          en: 'False' },
  explanation:                  { ar: 'الشرح',                        en: 'Explanation' },
  source_ref:                   { ar: 'المرجع',                       en: 'Source / Reference' },
  tags:                         { ar: 'الوسوم',                       en: 'Tags' },
  add_tag_prompt:               { ar: 'أضف وسم واضغط Enter',          en: 'Add tag and press Enter' },
  add_tag_btn:                  { ar: 'إضافة',                        en: 'Add' },
  favorite:                     { ar: '⭐ مفضّل',                     en: '⭐ Favorite' },
  marks_must_be_positive:       { ar: 'أكبر من صفر',                  en: 'Must be > 0' },
  required_field:               { ar: 'مطلوب',                        en: 'Required' },

  // ── Exam Builder ──
  exams_list:                   { ar: 'الامتحانات',                   en: 'Exams' },
  new_exam:                     { ar: 'امتحان جديد',                  en: 'New Exam' },
  edit_exam:                    { ar: 'تعديل امتحان',                 en: 'Edit Exam' },
  no_exams_yet:                 { ar: 'لا توجد امتحانات بعد.',        en: 'No exams yet.' },
  no_exams_hint:                { ar: 'ابدأ بإنشاء امتحان جديد واختر أسئلة من البنك', en: 'Start by creating a new exam and picking questions from the bank' },
  exam_title:                   { ar: 'عنوان الامتحان',               en: 'Exam Title' },
  exam_date:                    { ar: 'تاريخ الامتحان',               en: 'Exam date' },
  exam_instructions:            { ar: 'تعليمات الامتحان العامة',      en: 'General exam instructions' },
  exam_footer:                  { ar: 'تذييل الامتحان',               en: 'Exam footer' },
  exam_footer_hint:             { ar: 'نص يظهر في نهاية الامتحان',    en: 'Text at end of exam' },
  total_label:                  { ar: 'إجمالي',                       en: 'Total' },
  total_marks:                  { ar: 'درجة كلية',                    en: 'total marks' },
  sections_label:               { ar: 'أقسام',                        en: 'sections' },
  questions_label:              { ar: 'أسئلة',                        en: 'questions' },

  // ── Header info ──
  header_info:                  { ar: 'معلومات الترويسة (المعلم/المدرسة/الشعار)', en: 'Header info (teacher/school/logo)' },
  school_name:                  { ar: 'اسم المدرسة',                  en: 'School name' },
  center_name:                  { ar: 'اسم المركز',                   en: 'Center name' },
  teacher_name:                 { ar: 'اسم المعلم',                   en: 'Teacher name' },
  student_name_field:           { ar: 'حقل اسم الطالب',               en: 'Student name field' },
  class_field:                  { ar: 'حقل الفصل',                    en: 'Class field' },
  date_field:                   { ar: 'حقل التاريخ',                  en: 'Date field' },
  logo_upload:                  { ar: 'رفع شعار',                     en: 'Upload logo' },
  image_too_large:              { ar: 'الصورة كبيرة (حد 1MB)',        en: 'Image too large (max 1MB)' },

  // ── Sections ──
  section_label:                { ar: 'قسم',                          en: 'Section' },
  section_title_label:          { ar: 'عنوان القسم',                  en: 'Section title' },
  section_instructions:         { ar: 'تعليمات القسم (اختياري)',      en: 'Section instructions (optional)' },
  add_section:                  { ar: 'إضافة قسم',                    en: 'Add Section' },
  at_least_one_section:         { ar: 'لازم قسم واحد على الأقل',      en: 'At least one section required' },
  all_sections_need_title:      { ar: 'كل الأقسام تحتاج عنوان',       en: 'All sections need a title' },
  each_section_needs_question:  { ar: 'كل قسم يحتاج سؤال واحد على الأقل', en: 'Each section needs at least one question' },

  // ── Items ──
  search_bank:                  { ar: '🔍 ابحث في بنك الأسئلة...',    en: '🔍 Search question bank...' },
  add_to_exam:                  { ar: 'إضافة لامتحان',                en: 'Add to exam' },
  move_up:                      { ar: 'تحريك لأعلى',                  en: 'Move up' },
  move_down:                    { ar: 'تحريك لأسفل',                  en: 'Move down' },
  move_to_section:              { ar: 'نقل لقسم',                     en: 'Move to section' },
  remove_item:                  { ar: 'إزالة',                        en: 'Remove' },
  max_marks_cap:                { ar: 'الدرجة القصوى',                en: 'Max' },
  items_exceed_max:             { ar: 'سؤال بدرجة أعلى من المسموح',   en: 'items exceed max marks' },
  drag_to_reorder:              { ar: 'اسحب لإعادة الترتيب',          en: 'Drag to reorder' },

  // ── Designer ──
  exam_designer:                { ar: 'مصمم الامتحان',                en: 'Exam Designer' },
  builtin_templates:            { ar: 'قوالب جاهزة:',                 en: 'Built-in Templates:' },
  your_templates:               { ar: 'قوالبك المحفوظة:',             en: 'Your Templates:' },
  save_current_template:        { ar: 'حفظ القالب الحالي',            en: 'Save Current as Template' },
  template_name:                { ar: 'اسم القالب',                   en: 'Template name' },
  page_size:                    { ar: 'حجم الصفحة',                   en: 'Page size' },
  orientation:                  { ar: 'الاتجاه',                      en: 'Orientation' },
  portrait:                     { ar: 'طولي',                         en: 'Portrait' },
  landscape:                    { ar: 'عرضي',                         en: 'Landscape' },
  margin_mm:                    { ar: 'الهامش (مم)',                  en: 'Margin (mm)' },
  font_size:                    { ar: 'حجم الخط',                     en: 'Font size' },
  q_spacing:                    { ar: 'مسافة الأسئلة (مم)',           en: 'Q spacing (mm)' },
  line_spacing:                 { ar: 'تباعد الأسطر (مم)',            en: 'Line spacing (mm)' },
  question_numbering:           { ar: 'ترقيم الأسئلة',                en: 'Question numbering' },
  section_numbering:            { ar: 'ترقيم الأقسام',                en: 'Section numbering' },
  choice_layout:                { ar: 'تخطيط الاختيارات',             en: 'Choice layout' },
  vertical:                     { ar: 'رأسي',                         en: 'Vertical' },
  horizontal_2col:              { ar: 'أفقي (عمودين)',                en: 'Horizontal (2 cols)' },
  columns:                      { ar: 'عدد الأعمدة',                  en: 'Columns' },
  header_bg:                    { ar: 'خلفية الترويسة',               en: 'Header bg' },
  header_fg:                    { ar: 'لون الترويسة',                 en: 'Header fg' },
  section_bg:                   { ar: 'خلفية القسم',                  en: 'Section bg' },
  watermark_text:               { ar: 'علامة مائية',                  en: 'Watermark text' },
  watermark_opacity:            { ar: 'شفافية العلامة',               en: 'Watermark opacity' },
  show_borders:                 { ar: 'حدود',                         en: 'Borders' },
  show_logo:                    { ar: 'إظهار الشعار',                 en: 'Show logo' },
  language_label:               { ar: 'لغة الامتحان',                 en: 'Exam language' },
  lang_auto:                    { ar: 'تلقائي',                       en: 'Auto' },
  lang_arabic:                  { ar: 'العربية',                      en: 'Arabic' },
  lang_english:                 { ar: 'English',                      en: 'English' },
  done:                         { ar: '✓ تم',                         en: '✓ Done' },

  // ── Versions ──
  exam_versions:                { ar: 'نسخ الامتحان',                 en: 'Exam Versions' },
  create_new_version:           { ar: 'إنشاء نسخة جديدة',             en: 'Create new version' },
  version_label:                { ar: 'تسمية النسخة',                 en: 'Version label' },
  shuffle_questions:            { ar: 'خلط ترتيب الأسئلة',            en: 'Shuffle questions' },
  shuffle_choices:              { ar: 'خلط الاختيارات',               en: 'Shuffle choices' },
  create_btn:                   { ar: 'إنشاء',                        en: 'Create' },
  no_versions_yet:              { ar: 'لا توجد نسخ بعد. أنشئ النسخة الأولى.', en: 'No versions yet. Create the first one.' },
  version_preserved_note:       { ar: 'الإجابات الصحيحة تُحفظ تلقائيًا حتى لو تم خلط الاختيارات — مفتاح الإجابات يبقى متوافقًا مع كل نسخة.', en: 'Correct answers are preserved even when choices are shuffled — the answer key stays synced with each version.' },
  version_exists:               { ar: 'النسخة موجودة بالفعل',         en: 'Version already exists' },

  // ── Preview / PDF ──
  exam_preview:                 { ar: 'معاينة الامتحان',              en: 'Exam Preview' },
  preview_pdf:                  { ar: 'معاينة + PDF',                 en: 'Preview + PDF' },
  select_version:               { ar: 'اختر النسخة',                  en: 'Select version' },
  original_version:             { ar: 'الأصلية',                      en: 'Original' },
  download_exam_pdf:            { ar: 'تحميل الامتحان PDF',           en: 'Download Exam PDF' },
  download_answer_key:          { ar: 'تحميل نموذج الإجابة',          en: 'Download Answer Key' },
  preview_note:                 { ar: 'المعاينة بالأسفل هي نفسها ملف الـ PDF الذي ستحمله — مش محتاجة إعادة فتح.', en: 'The preview below is the exact PDF you will download — no surprises.' },
  pdf_vector_note:              { ar: 'الـ PDF وثيقة فيكتور حقيقية — قابلة للطباعة على أي طابعة.', en: 'The PDF is a true vector document — printable on any printer.' },

  // ── Import ──
  import_title:                 { ar: 'استيراد أسئلة',                en: 'Import Questions' },
  tab_paste:                    { ar: '📋 لصق نص',                    en: '📋 Paste Text' },
  tab_file:                     { ar: '📁 ملف PDF/صورة',              en: '📁 PDF/Image File' },
  tab_history:                  { ar: '🕐 المراجعة',                  en: 'Review Queue' },
  parse_btn:                    { ar: '🔍 تحليل',                     en: 'Parse' },
  no_questions_found:           { ar: 'لم يتم العثور على أسئلة',      en: 'No questions found' },
  extracted_count:              { ar: 'تم استخراج سؤال — راجعهم',     en: 'Extracted questions — review them' },
  no_questions_to_save:         { ar: 'لا يوجد أسئلة للحفظ',          en: 'No questions to save' },
  save_to_review:               { ar: 'حفظ في قائمة المراجعة',       en: 'Save to Review Queue' },
  add_to_bank:                  { ar: 'إضافة لبنك الأسئلة',           en: 'Add to bank' },
  no_imports_pending:           { ar: 'لا توجد استيرادات بانتظار المراجعة.', en: 'No imports pending review.' },
  extraction_failed:            { ar: 'فشل الاستخراج',                en: 'Extraction failed' },
  file_too_large_note:          { ar: 'ارفع ملف PDF أو صورة. سيتم استخراج النص آليًا ثم تحليله. ملاحظة: الاستخراج قد لا يكون دقيقًا 100% — راجع الأسئلة قبل الحفظ.', en: 'Upload a PDF or image file. Text will be extracted automatically then parsed. Note: extraction may not be 100% accurate — review before saving.' },
  paste_help:                   { ar: 'الصق الأسئلة بهذا الشكل (سؤال لكل كتلة، سطر فارغ بين الكتل):', en: 'Paste questions in this format (one block per question, blank line between):' },

  // ── Common actions ──
  save:                         { ar: '💾 حفظ',                       en: '💾 Save' },
  cancel:                       { ar: 'إلغاء',                       en: 'Cancel' },
  back:                         { ar: '← رجوع',                      en: '← Back' },
  delete:                       { ar: 'حذف',                         en: 'Delete' },
  delete_permanent:             { ar: 'حذف نهائي',                   en: 'Delete' },
  edit:                         { ar: 'تعديل',                       en: 'Edit' },
  duplicate:                    { ar: 'نسخ',                         en: 'Duplicate' },
  designer_btn:                 { ar: '🎨 المصمم',                   en: '🎨 Designer' },
  versions_btn:                 { ar: '🔤 النسخ',                    en: 'Versions' },
  preview_btn:                  { ar: '👁️ معاينة',                  en: 'Preview' },

  // ── Toast messages (human, never technical) ──
  saved_success:                { ar: '✅ تم الحفظ',                 en: '✅ Saved' },
  save_failed:                  { ar: 'فشل الحفظ — حاول مرة أخرى',  en: 'Save failed — try again' },
  deleted_success:              { ar: 'تم الحذف',                    en: 'Deleted' },
  delete_failed:                { ar: 'فشل الحذف',                   en: 'Delete failed' },
  duplicated_success:           { ar: '✅ تم النسخ',                 en: '✅ Duplicated' },
  duplicate_failed:             { ar: 'فشل النسخ',                   en: 'Duplicate failed' },
  load_failed:                  { ar: 'فشل تحميل البيانات',          en: 'Failed to load data' },
  pdf_generated:                { ar: '✅ تم إنشاء PDF',             en: '✅ PDF generated' },
  answer_key_generated:         { ar: '✅ تم إنشاء نموذج الإجابة',    en: '✅ Answer key generated' },
  pdf_generation_failed:        { ar: 'حدث خطأ أثناء إنشاء الامتحان. حاول مرة أخرى.', en: 'Something went wrong while generating the exam. Please try again.' },
  fix_errors_first:             { ar: 'تحقق من الأخطاء أولاً',       en: 'Fix errors first' },
  question_added:               { ar: '✅ تمت إضافة السؤال',          en: '✅ Question added' },
  imported_to_bank:             { ar: '✅ تمت الإضافة لبنك الأسئلة',  en: '✅ Added to bank' },
  saved_to_review:              { ar: '✅ تم الحفظ في قائمة المراجعة', en: '✅ Saved to review queue' },
  template_applied:             { ar: 'تم تطبيق القالب',             en: 'Template applied' },
  template_saved:               { ar: '✅ تم حفظ القالب',             en: '✅ Template saved' },
  template_save_failed:         { ar: 'فشل حفظ القالب',              en: 'Template save failed' },
  template_delete_failed:       { ar: 'فشل حذف القالب',              en: 'Template delete failed' },
  version_created:              { ar: '✅ تم إنشاء النسخة',           en: '✅ Version created' },
  version_create_failed:        { ar: 'فشل إنشاء النسخة',            en: 'Version create failed' },

  // ── Confirm dialogs ──
  confirm_delete_exam_title:    { ar: 'حذف الامتحان',                en: 'Delete Exam' },
  confirm_delete_exam_msg:      { ar: 'هيتحذف الامتحان وكل أقسامه وأسئلته ونسخه نهائيًا.', en: 'This will permanently delete the exam, its sections, items, and versions.' },
  confirm_delete_question_title:{ ar: 'حذف السؤال',                  en: 'Delete Question' },
  confirm_delete_question_msg:  { ar: 'هيتحذف السؤال نهائيًا. لو مستخدم في امتحانات موجودة، الامتحانات دي هتفقد ربطها بالسؤال.', en: 'This question will be permanently deleted. Exams that reference it will lose the link.' },

  // ── PDF content labels (rendered inside the PDF itself) ──
  pdf_student_name:             { ar: 'اسم الطالب:',                 en: 'Student Name:' },
  pdf_class:                    { ar: 'الفصل:',                      en: 'Class:' },
  pdf_date:                     { ar: 'التاريخ:',                    en: 'Date:' },
  pdf_marks:                    { ar: 'درجة',                        en: 'marks' },
  pdf_section_marks:            { ar: 'درجة',                        en: 'marks' },  // [5 درجة]
  pdf_teacher:                  { ar: 'المعلم:',                     en: 'Teacher:' },
  pdf_page:                     { ar: 'صفحة',                        en: 'Page' },
  pdf_of:                       { ar: 'من',                          en: 'of' },
  pdf_answer_key_title:         { ar: 'نموذج الإجابات',              en: 'Answer Key' },
  pdf_correct_answer:           { ar: 'الإجابة الصحيحة:',            en: 'Correct answer:' },
  pdf_explanation:              { ar: 'الشرح:',                      en: 'Explanation:' },
  pdf_answer_label:             { ar: 'الإجابة:',                    en: 'Answer:' },
  pdf_true:                     { ar: 'صح',                          en: 'True' },
  pdf_false:                    { ar: 'خطأ',                         en: 'False' },
  pdf_version:                  { ar: 'نسخة:',                       en: 'Version:' },
  pdf_exam_title_fallback:      { ar: 'امتحان',                      en: 'Exam' },

  // ── Validation errors ──
  err_exam_not_found:           { ar: 'الامتحان غير موجود',          en: 'Exam not found' },
  err_no_sections:              { ar: 'الامتحان لازم يحتوي على قسم واحد على الأقل', en: 'Exam must contain at least one section' },
  err_empty_section:            { ar: 'كل قسم لازم يحتوي على سؤال واحد على الأقل', en: 'Each section must contain at least one question' },
  err_invalid_marks:            { ar: 'في درجات غير صحيحة — راجع الأسئلة', en: 'Some marks are invalid — review the questions' },
  err_total_mismatch:           { ar: 'إجمالي الدرجات غير متطابق',   en: 'Total marks do not match' },
}

/**
 * Get a label in the requested language.
 * @param {string} key — key in QB_LABELS
 * @param {boolean} isArabic — true for Arabic, false for English
 * @returns {string} the label, or the key itself if not found (for easy debugging)
 */
export function L(key, isArabic) {
  const entry = QB_LABELS[key]
  if (!entry) {
    // In dev, surface missing keys loudly. In prod, return key as fallback.
    if (typeof console !== 'undefined') console.warn('[qbLabels] missing key:', key)
    return key
  }
  return isArabic ? entry.ar : entry.en
}

/**
 * Hook-style helper for components that already use isArabic.
 * Returns a function `L(key)` bound to the current language.
 */
export function useQbLabels(isArabic) {
  return { L: (key) => L(key, isArabic) }
}

/**
 * Maps a technical error to a human message.
 * Used by toast/error handlers — never expose raw error codes to users.
 */
export function humanizeError(err, isArabic) {
  if (!err) return L('pdf_generation_failed', isArabic)
  const msg = err.message || String(err)
  // Map known patterns
  if (msg.includes('duplicate') || msg.includes('unique')) return L('version_exists', isArabic)
  if (msg.includes('network') || msg.includes('fetch')) return L('load_failed', isArabic)
  if (msg.includes('permission') || msg.includes('RLS') || msg.includes('policy')) return L('save_failed', isArabic)
  // Default: generic message, log technical detail
  console.error('[QB error]', err)
  return L('pdf_generation_failed', isArabic)
}
