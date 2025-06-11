
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

// Original schema for individual messages in the history (external contract)
const ChatMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string(),
});

// Original input schema for the exported flow function
const ChatbotInputSchema = z.object({
  query: z.string().describe('The current query from the user.'),
  history: z.array(ChatMessageSchema).optional().describe('The recent conversation history.'),
});
export type ChatbotInput = z.infer<typeof ChatbotInputSchema>;

// Output schema for the exported flow function (remains unchanged)
const ChatbotOutputSchema = z.object({
  response: z.string().describe('The chatbot\'s response to the user query.'),
});
export type ChatbotOutput = z.infer<typeof ChatbotOutputSchema>;

// --- Internal Schemas for the Prompt ---
// Augmented message schema for the prompt's template context
const PromptChatMessageSchema = ChatMessageSchema.extend({
  isUser: z.boolean().optional(),
  isModel: z.boolean().optional(),
});

// Augmented input schema for the prompt itself (what the template engine sees)
const PromptInputSchema = z.object({
  query: z.string(),
  history: z.array(PromptChatMessageSchema).optional(),
});
// --- End Internal Schemas ---

export async function researchSphereChatbot(input: ChatbotInput): Promise<ChatbotOutput> {
  return researchSphereChatbotFlow(input);
}

const chatbotPrompt = ai.definePrompt({
  name: 'researchSphereChatbotPrompt',
  model: 'googleai/gemini-1.5-flash',
  input: {schema: PromptInputSchema}, // Use the internal, augmented schema for the template
  output: {schema: ChatbotOutputSchema},
  prompt: `You are ResearchSphere Assistant, a friendly and helpful AI chatbot.
Your primary goal is to assist users with queries related to the ResearchSphere platform.
ResearchSphere is a system for submitting, managing, and evaluating research papers using AI tools.

You can answer questions about:
- How to submit a paper (uploading PDF/DOCX, filling forms).
- AI-powered features:
  - The platform offers an 'AI Pre-Check' feature (under the Author menu if logged in as an author) where authors can get preliminary feedback on their paper's title, abstract, and .txt file content for plagiarism and acceptance probability *before* formal submission. This tool helps authors improve their manuscript.
  - For formal submissions, AI plagiarism checks (on the uploaded file) and acceptance probability assessments (on the abstract) are part of the review and evaluation process. These AI evaluations are included as part of the services covered by the submission fees or subscription plans detailed on the Registration page.
- Navigating the platform, including Author, Reviewer, and Admin dashboards.
- Platform registration options, submission fees, and payment methods.
- User roles (Author, Reviewer, Admin), and profile settings.
- Finding sample templates for manuscripts or cover letters.
- Searching for published papers on the platform.
- How to contact support for further assistance.
- The general purpose of the platform.

If a user asks a question outside of these topics, or asks for opinions, personal advice, or anything unrelated to the ResearchSphere platform's functionality and purpose, politely state that you can only help with ResearchSphere-related queries. Do not attempt to answer off-topic questions.
Keep your answers concise, helpful, and easy to understand.

{{#if history}}
Conversation History (for context):
{{#each history}}
  {{#if isUser}}User: {{text}}{{/if}}
  {{#if isModel}}Assistant: {{text}}{{/if}}
{{/each}}
{{/if}}

Current user query: {{{query}}}
Assistant response:
`,
});

const researchSphereChatbotFlow = ai.defineFlow(
  {
    name: 'researchSphereChatbotFlow',
    inputSchema: ChatbotInputSchema,     // Flow's public API uses the original input schema
    outputSchema: ChatbotOutputSchema,
  },
  async (input: ChatbotInput) => { // input is of type ChatbotInput (original schema)
    // Augment history for the prompt template
    const augmentedHistory = input.history?.map(msg => ({
      ...msg,
      isUser: msg.role === 'user',
      isModel: msg.role === 'model',
    }));

    // Create the input object that matches the PromptInputSchema for the internal prompt call
    const promptInputForInternalCall = {
      query: input.query,
      history: augmentedHistory,
    };

    const {output} = await chatbotPrompt(promptInputForInternalCall); // Pass augmented data
    return output!;
  }
);

