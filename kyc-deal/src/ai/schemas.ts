/** Zod schemas for every structured frontier call. The model never returns
 *  free text — only validated objects. */

import { z } from 'zod';

export const ParsedQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        section: z.string().describe('The section/heading this question sits under, or "" if none.'),
        prompt: z.string().describe('The question, verbatim, as a single self-contained ask.'),
        kind: z
          .enum(['text', 'yesno', 'entity', 'ubo_list', 'pct', 'date', 'choice', 'number'])
          .describe('Expected answer shape.'),
        options: z.array(z.string()).describe('Choices, for kind="choice"; otherwise [].'),
      }),
    )
    .describe('Every distinct question in the questionnaire, in order.'),
});
export type ParsedQuestions = z.infer<typeof ParsedQuestionsSchema>;

export const AnswerSchema = z.object({
  value: z.string().describe('The answer to the question, ready to drop into the form.'),
  rationale: z.string().describe('One or two sentences on how the structure supports this answer.'),
  confidence: z.number().min(0).max(1).describe('0–1 confidence given the available facts.'),
  needsReview: z.boolean().describe('True if a human must check this before it goes out.'),
  citations: z
    .array(
      z.object({
        factType: z.enum(['attribute', 'entity', 'edge', 'ubo']),
        factId: z.string().describe('The id of the structure fact this rests on, from the provided context.'),
        quote: z.string().describe('The exact substring of that fact relied upon.'),
      }),
    )
    .describe('The structure facts this answer cites. Empty only if no fact applies.'),
});
export type ModelAnswer = z.infer<typeof AnswerSchema>;
