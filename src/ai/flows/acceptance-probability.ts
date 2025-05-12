// use server'

/**
 * @fileOverview Provides an AI flow to determine the acceptance probability score of a research paper.
 *
 * - acceptanceProbability - A function that takes paper content and returns an acceptance probability score.
 * - AcceptanceProbabilityInput - The input type for the acceptanceProbability function.
 * - AcceptanceProbabilityOutput - The return type for the acceptanceProbability function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AcceptanceProbabilityInputSchema = z.object({
  paperText: z.string().describe('The text content of the research paper.'),
});
export type AcceptanceProbabilityInput = z.infer<typeof AcceptanceProbabilityInputSchema>;

const AcceptanceProbabilityOutputSchema = z.object({
  probabilityScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The probability score (between 0 and 1) indicating the likelihood of the paper being accepted.'
    ),
  reasoning: z.string().describe('The reasoning behind the assigned probability score.'),
});
export type AcceptanceProbabilityOutput = z.infer<typeof AcceptanceProbabilityOutputSchema>;

export async function acceptanceProbability(input: AcceptanceProbabilityInput): Promise<AcceptanceProbabilityOutput> {
  return acceptanceProbabilityFlow(input);
}

const acceptanceProbabilityPrompt = ai.definePrompt({
  name: 'acceptanceProbabilityPrompt',
  input: {schema: AcceptanceProbabilityInputSchema},
  output: {schema: AcceptanceProbabilityOutputSchema},
  prompt: `You are an AI assistant that evaluates the acceptance probability of a research paper for publication in a conference or journal.

  Assess the paper based on content quality, originality, clarity, structure, and novelty.
  Provide a probability score between 0 and 1, where 0 indicates a very low chance of acceptance and 1 indicates a very high chance.
  Also, provide a reasoning for the assigned probability score.

  Paper Text:
  {{paperText}}`,
});

const acceptanceProbabilityFlow = ai.defineFlow(
  {
    name: 'acceptanceProbabilityFlow',
    inputSchema: AcceptanceProbabilityInputSchema,
    outputSchema: AcceptanceProbabilityOutputSchema,
  },
  async input => {
    const {output} = await acceptanceProbabilityPrompt(input);
    return output!;
  }
);
