// lib/qbAiProvider.js
// Stub AI provider. The whole Nokhba QB system works without AI.
// Future phases can swap this stub with any real provider (OpenAI, local Llama, etc.)
// without touching any UI code — UIs check `isAvailable` before showing AI buttons.

export const qbAi = {
  isAvailable: false,
  providerName: 'stub',

  /**
   * Generate questions from a prompt / source text.
   * @returns {Promise<never>} always throws AI_NOT_CONFIGURED
   */
  generateQuestions: async (_opts) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },

  /**
   * Improve / rewrite an existing question's text.
   */
  improveQuestion: async (_question) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },

  /**
   * Estimate a difficulty score (easy/medium/hard) for a question.
   */
  estimateDifficulty: async (_question) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },

  /**
   * Generate a student-facing explanation for a question.
   */
  generateExplanation: async (_question) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },

  /**
   * Auto-generate a complete exam from a topic / weak-topic list.
   */
  generateExam: async (_opts) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },

  /**
   * Detect weak topics from a student's past results.
   */
  detectWeakTopics: async (_studentResults) => {
    throw { code: 'AI_NOT_CONFIGURED', message: 'No AI provider configured.' }
  },
}

/**
 * Helper for UIs: safely call any AI method and return either the result
 * or a structured `{ unavailable: true }` sentinel — never throws.
 */
export async function tryAi(method, ...args) {
  if (!qbAi.isAvailable) return { unavailable: true }
  try {
    return await qbAi[method](...args)
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return { unavailable: true }
    return { error: e?.message || String(e) }
  }
}
