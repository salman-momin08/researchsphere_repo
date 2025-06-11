
'use server';
/**
 * @fileOverview A ResearchSphere assistant chatbot flow.
 *
 * - researchSphereChatbot - A function that handles chatbot queries.
 * - ChatbotInput - The input type for the researchSphereChatbot function.
 * - ChatbotOutput - The return type for the researchSphereChatbot function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string(),
});

export const ChatbotInputSchema = z.object({
  query: z.string().describe('The current query from the user.'),
  history: z.array(ChatMessageSchema).optional().describe('The recent conversation history.'),
});
export type ChatbotInput = z.infer<typeof ChatbotInputSchema>;

export const ChatbotOutputSchema = z.object({
  response: z.string().describe('The chatbot\'s response to the user query.'),
});
export type ChatbotOutput = z.infer<typeof ChatbotOutputSchema>;

export async function researchSphereChatbot(input: ChatbotInput): Promise<ChatbotOutput> {
  return researchSphereChatbotFlow(input);
}

const chatbotPrompt = ai.definePrompt({
  name: 'researchSphereChatbotPrompt',
  model: 'googleai/gemini-1.5-flash',
  input: {schema: ChatbotInputSchema},
  output: {schema: ChatbotOutputSchema},
  prompt: `You are ResearchSphere Assistant, a friendly and helpful AI chatbot.
Your primary goal is to assist users with queries related to the ResearchSphere platform.
ResearchSphere is a system for submitting, managing, and evaluating research papers using AI tools.

You can answer questions about:
- How to submit a paper (uploading PDF/DOCX, filling forms).
- AI plagiarism checks (based on abstract/file) and acceptance probability scores (based on abstract).
- Navigating the platform, including Author, Reviewer, and Admin dashboards.
- Platform registration, user roles (Author, Reviewer, Admin), and profile settings.
- Submission fees and payment options.
- Finding sample templates for manuscripts or cover letters.
- Searching for published papers on the platform.
- How to contact support for further assistance.
- The general purpose of the platform.

If a user asks a question outside of these topics, or asks for opinions, personal advice, or anything unrelated to the ResearchSphere platform's functionality and purpose, politely state that you can only help with ResearchSphere-related queries. Do not attempt to answer off-topic questions.
Keep your answers concise, helpful, and easy to understand.

{{#if history}}
Conversation History (for context):
{{#each history}}
  {{#if (eq role "user")}}User: {{text}}{{/if}}
  {{#if (eq role "model")}}Assistant: {{text}}{{/if}}
{{/each}}
{{/if}}

Current user query: {{{query}}}
Assistant response:
`,
});

const researchSphereChatbotFlow = ai.defineFlow(
  {
    name: 'researchSphereChatbotFlow',
    inputSchema: ChatbotInputSchema,
    outputSchema: ChatbotOutputSchema,
  },
  async (input) => {
    const {output} = await chatbotPrompt(input);
    return output!;
  }
);
