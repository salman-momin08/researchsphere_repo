
// This is an experimental implementation that does not actually check for plagiarism.
// Instead it calls an LLM to generate a plausible plagiarism score and some highlighted sections.
// It should be replaced with a real plagiarism checking service.

'use server';

/**
 * @fileOverview Implements the plagiarism check flow using Genkit.
 *
 * - plagiarismCheck - The main function to check a document for plagiarism.
 * - PlagiarismCheckInput - Input type for the plagiarismCheck function.
 * - PlagiarismCheckOutput - Output type for the plagiarismCheck function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PlagiarismCheckInputSchema = z.object({
  documentUrl: z
    .string()
    .url()
    .optional()
    .describe('The publicly accessible URL of the document to check for plagiarism (used for formal submissions).'),
  documentText: z.string().optional().describe('The text content of the document (e.g., title + abstract + .txt content for pre-check).'),
  fileName: z.string().optional().describe('The original name of the file, for context.'),
  fileType: z.string().optional().describe('The MIME type of the file (e.g., "text/plain", "application/pdf"), for context.'),
});
export type PlagiarismCheckInput = z.infer<typeof PlagiarismCheckInputSchema>;

const PlagiarismCheckOutputSchema = z.object({
  plagiarismScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'A score between 0 and 1 indicating the likelihood of plagiarism, where 1 is definite plagiarism.'
    ),
  highlightedSections: z
    .array(z.string())
    .describe(
      'Sections of the document that may be plagiarized, highlighted for review.'
    ),
});
export type PlagiarismCheckOutput = z.infer<typeof PlagiarismCheckOutputSchema>;

export async function plagiarismCheck(input: PlagiarismCheckInput): Promise<PlagiarismCheckOutput> {
  return plagiarismCheckFlow(input);
}

// Define an extended schema for the prompt's input, including boolean flags for file types
const PromptInputSchema = PlagiarismCheckInputSchema.extend({
  isPdf: z.boolean().optional(),
  isDocx: z.boolean().optional(),
  isTxt: z.boolean().optional(),
  isOtherFileType: z.boolean().optional(),
});

const plagiarismCheckPrompt = ai.definePrompt({
  name: 'plagiarismCheckPrompt',
  input: {schema: PromptInputSchema}, // Use the extended schema
  output: {schema: PlagiarismCheckOutputSchema},
  prompt: `You are an AI plagiarism checker.
{{#if documentUrl}}
You are analyzing a document accessible at the URL: {{{documentUrl}}}.
{{else if documentText}}
You are analyzing the following document text:
{{{documentText}}}
{{else}}
No document content (URL or text) was provided. You cannot perform an accurate plagiarism check. State this limitation clearly in your output.
{{/if}}

{{#if fileName}}
The document is referred to as "{{{fileName}}}".
{{/if}}

{{#if fileType}}
  {{#if isPdf}}
  The document is a PDF. The provided text (if any) represents key excerpts like the title and abstract. Perform your analysis assuming these excerpts come from a full PDF document with this name.
  {{else}}
    {{#if isDocx}}
  The document is a DOCX file. The provided text (if any) represents key excerpts like the title and abstract. Perform your analysis assuming these excerpts come from a full DOCX document with this name.
    {{else}}
      {{#if isTxt}}
  The document is a plain text file, and the provided text should be considered its full content for analysis.
      {{else}}
        {{#if isOtherFileType}}
  The document type is "{{{fileType}}}". Consider this type when evaluating the provided text.
        {{else}}
  The document type is "{{{fileType}}}". Consider this type when evaluating the provided text.
        {{/if}}
      {{/if}}
    {{/if}}
  {{/if}}
{{else if fileName}}
Consider the file name "{{{fileName}}}" and its likely type when evaluating the provided text (if any).
{{/if}}

Your task is to provide a plagiarism score between 0 and 1 (where 1 indicates definite plagiarism) and highlight specific sections from the provided text that appear to be copied or reused from common knowledge sources or unoriginal.
If no document text or URL was provided, or if the content is insufficient for analysis, return a plagiarism score of -1 and explain the issue in the highlightedSections.

Output in JSON format.`,
});

const plagiarismCheckFlow = ai.defineFlow(
  {
    name: 'plagiarismCheckFlow',
    inputSchema: PlagiarismCheckInputSchema, // Flow input remains the original schema
    outputSchema: PlagiarismCheckOutputSchema,
  },
  async input => {
    // Pre-process to create boolean flags for the prompt
    const isPdf = input.fileType === "application/pdf";
    const isDocx = input.fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isTxt = input.fileType === "text/plain";
    const isOtherFileType = !!(input.fileType && !isPdf && !isDocx && !isTxt);

    const promptInputData = {
      ...input,
      isPdf,
      isDocx,
      isTxt,
      isOtherFileType,
    };

    const {output} = await plagiarismCheckPrompt(promptInputData);
    // Handle the -1 score case if AI indicates insufficient data
    if (output && output.plagiarismScore === -1 && output.highlightedSections && output.highlightedSections.length > 0) {
        // You might want to throw an error here or return a specific error structure
        // For now, we'll pass it through, the UI can interpret -1.
    }
    return output!;
  }
);
