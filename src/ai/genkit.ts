
'use server'; // Keep this if your AI flows are server actions

import { genkit, GenkitError, type ModelArgument } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod'; // Assuming z is used by your flows, keep if needed

let aiInstance: any;

try {
  // Ensure GOOGLE_API_KEY (or similar, depending on googleAI plugin needs)
  // is available in the environment where this server-side code runs (e.g., Vercel serverless functions).
  // This might be different from NEXT_PUBLIC_ variables.
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) { // Check for common key names
    aiInstance = genkit({
      plugins: [googleAI()],
      // Removed default model from here to rely on plugin defaults or explicit model in flows
      // model: 'googleai/gemini-2.0-flash',
    });
    // console.info("Genkit AI initialized successfully.");
  } else {
    console.warn("Genkit AI: GOOGLE_API_KEY (or GEMINI_API_KEY for googleAI plugin) is not set in the server environment. Genkit googleAI plugin might not function.");
    // Provide a stub that allows the app to load but AI features will fail.
    aiInstance = {
      defineFlow: (config: any, handler: any) => {
        console.warn(`Genkit AI STUB: defineFlow called for ${config.name}, but AI is not initialized.`);
        return async (input: any) => {
          // console.error(`Genkit AI STUB: Flow ${config.name} called with input:`, input, "AI not initialized.");
          throw new GenkitError({
            source: 'genkit-stub',
            status: 'UNAVAILABLE',
            message: `AI service (Genkit) is not initialized. Flow '${config.name}' cannot run. Check server logs for Genkit/GoogleAI configuration issues.`,
          });
        };
      },
      definePrompt: (config: any) => {
        console.warn(`Genkit AI STUB: definePrompt called for ${config.name}, but AI is not initialized.`);
        return async (input: any) => {
          // console.error(`Genkit AI STUB: Prompt ${config.name} called with input:`, input, "AI not initialized.");
          return {
            output: null, // Or throw an error
            usage: {},
            history: [],
            request: {},
            response: {},
            latency: 0,
            text: () => Promise.reject(new GenkitError({
              source: 'genkit-stub',
              status: 'UNAVAILABLE',
              message: `AI service (Genkit) is not initialized. Prompt '${config.name}' cannot run.`,
            })),
            // Add other methods if your specific usage of prompt result requires them
          };
        };
      },
      generate: async (options: ModelArgument) => {
        // console.error("Genkit AI STUB: generate called, but AI is not initialized. Options:", options);
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) is not initialized. Generation for prompt '${options.prompt}' cannot run.`,
        });
      },
      // Add stubs for other ai methods if you use them directly, e.g., defineSchema
      defineSchema: (name: string, schema: any) => {
        console.warn(`Genkit AI STUB: defineSchema called for ${name}, but AI is not initialized.`);
        return schema;
      },
      // If you use ai.embed directly:
      embed: async (options: any) => {
        console.warn(`Genkit AI STUB: embed called, but AI is not initialized.`);
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) is not initialized. Embedding cannot run.`,
        });
      }
    };
  }
} catch (error: any) {
  console.error("CRITICAL Genkit AI Initialization Error:", error.message, error.stack);
  // Provide a stub that allows the app to load but AI features will fail.
  aiInstance = {
    defineFlow: (config: any, handler: any) => {
      console.warn(`Genkit AI STUB (init error): defineFlow called for ${config.name}.`);
      return async (input: any) => {
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) failed to initialize. Flow '${config.name}' cannot run. Check server logs for errors.`,
        });
      };
    },
    definePrompt: (config: any) => {
      console.warn(`Genkit AI STUB (init error): definePrompt called for ${config.name}.`);
      return async (input: any) => {
        return { output: null, usage: {}, history: [], request: {}, response: {}, latency: 0, text: () => Promise.reject(new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) failed to initialize. Prompt '${config.name}' cannot run.`,
        })) };
      };
    },
    generate: async (options: ModelArgument) => {
      throw new GenkitError({
        source: 'genkit-stub',
        status: 'UNAVAILABLE',
        message: `AI service (Genkit) failed to initialize. Generation for prompt '${options.prompt}' cannot run.`,
      });
    },
    defineSchema: (name: string, schema: any) => schema,
    embed: async (options: any) => {
      throw new GenkitError({
        source: 'genkit-stub',
        status: 'UNAVAILABLE',
        message: `AI service (Genkit) failed to initialize. Embedding cannot run.`,
      });
    }
  };
}

export const ai = aiInstance;
