
'use server';
/**
 * @fileOverview A Genkit flow to generate a robot icon image.
 *
 * - generateRobotIcon - A function that generates an image of a robot icon.
 * - GenerateRobotIconInput - The input type for the generateRobotIcon function.
 * - GenerateRobotIconOutput - The return type for the generateRobotIcon function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateRobotIconInputSchema = z.object({
  prompt: z.string().describe('The prompt for generating the robot icon. e.g., "a friendly, minimalist robot assistant icon for a chatbot button, circular, simple lines, teal and white colors"'),
});
export type GenerateRobotIconInput = z.infer<typeof GenerateRobotIconInputSchema>;

const GenerateRobotIconOutputSchema = z.object({
  imageDataUri: z.string().describe('The generated image as a data URI.'),
});
export type GenerateRobotIconOutput = z.infer<typeof GenerateRobotIconOutputSchema>;

export async function generateRobotIcon(input: GenerateRobotIconInput): Promise<GenerateRobotIconOutput> {
  return generateRobotIconFlow(input);
}

const generateRobotIconFlow = ai.defineFlow(
  {
    name: 'generateRobotIconFlow',
    inputSchema: GenerateRobotIconInputSchema,
    outputSchema: GenerateRobotIconOutputSchema,
  },
  async (input) => {
    const {media} = await ai.generate({
      model: 'googleai/gemini-2.0-flash-exp',
      prompt: input.prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'], // Important: Must include TEXT even if only IMAGE is primary
      },
    });

    if (!media || !media.url) {
      throw new Error('Image generation failed or returned no media URL.');
    }

    return {imageDataUri: media.url};
  }
);
