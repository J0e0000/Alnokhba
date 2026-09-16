// lib/qbRandomize.js
// Generates exam versions (A/B/C) by shuffling question order and/or MCQ choice order.
// CRITICAL: correct_answer is preserved by computing choice permutation, not by mutating it.

/**
 * Fisher-Yates shuffle (returns a new array, does not mutate input).
 */
export function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Generate a permutation array `perm` of length n where perm[newIndex] = oldIndex.
 * Used to reorder items/choices without losing track of the correct one.
 */
export function permutation(n) {
  const idx = shuffle([...Array(n).keys()])
  return idx
}

/**
 * Build a list of version items for a given exam.
 * Input: flat list of `{ question, item, section }` in original order.
 * Output: list of `{ question_id, order_idx, choice_order }` after applying shuffle.
 *
 * - If shuffle_questions === false, order is preserved.
 * - If shuffle_choices === true and question.type === 'mcq', choices are permuted
 *   and `choice_order` carries the permutation so the PDF renderer knows which
 *   old choice index goes where.
 */
export function buildVersionItems(flatItems, { shuffle_questions, shuffle_choices }) {
  let ordered = flatItems
  if (shuffle_questions) {
    // Shuffle within each section (per-section shuffle, not global).
    const bySection = new Map()
    flatItems.forEach((it) => {
      if (!bySection.has(it.section_id)) bySection.set(it.section_id, [])
      bySection.get(it.section_id).push(it)
    })
    ordered = []
    for (const list of bySection.values()) {
      const perm = permutation(list.length)
      perm.forEach((oldIdx) => ordered.push(list[oldIdx]))
    }
  }

  return ordered.map((it, i) => {
    let choiceOrder = []
    if (shuffle_choices && it.question?.type === 'mcq' && Array.isArray(it.question.choices)) {
      choiceOrder = permutation(it.question.choices.length)
    } else if (it.question?.type === 'mcq' && Array.isArray(it.question.choices)) {
      choiceOrder = [...Array(it.question.choices.length).keys()]
    }
    return {
      question_id: it.question_id,
      order_idx: i,
      choice_order: choiceOrder,
    }
  })
}

/**
 * Given a question's `correct_answer` ({index: N}) and a `choice_order` permutation,
 * compute the NEW correct index in the rendered version.
 *
 * choice_order[newIdx] = oldIdx
 * so if oldCorrectIdx = N, we want newIdx where choice_order[newIdx] === N.
 */
export function remapCorrectIndex(oldCorrectIdx, choice_order) {
  if (!Array.isArray(choice_order) || choice_order.length === 0) return oldCorrectIdx
  const newIdx = choice_order.indexOf(oldCorrectIdx)
  return newIdx === -1 ? oldCorrectIdx : newIdx
}

/**
 * Generate N labeled versions (A, B, C, ...) with shuffled configurations.
 * Each version gets a deterministic-ish but different shuffle.
 */
export function generateVersionLabels(count) {
  const labels = []
  for (let i = 0; i < count; i++) {
    labels.push(String.fromCharCode(65 + i)) // A, B, C, ...
  }
  return labels
}
