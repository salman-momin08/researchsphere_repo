
'use server'; // Keep this if your AI flows are server actions

import { genkit, GenkitError, type ModelArgument } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod'; // Assuming z is used by your flows, keep if needed

let aiInstance: any;

try {
  // Ensure GOOGLE_API_KEY or GEMINI_API_KEY (depending on googleAI plugin needs for specific models or Vertex AI)
  // is available in the server environment (e.g., Vercel serverless functions).
  // These are NOT prefixed with NEXT_PUBLIC_.
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    aiInstance = genkit({
      plugins: [googleAI()],
    });
    // console.info("Genkit AI initialized successfully with provided API key.");
  } else {
    // Attempt to initialize with Application Default Credentials (ADC) if GOOGLE_APPLICATION_CREDENTIALS is set,
    // or if the environment (like Google Cloud Run/Functions) provides them automatically.
    // If no specific keys are found, googleAI() might still work with free-tier models or ADC.
    // console.warn("Genkit AI: GOOGLE_API_KEY or GEMINI_API_KEY is not set. Attempting to initialize googleAI() plugin, which may rely on Application Default Credentials or free tier access.");
    aiInstance = genkit({
      plugins: [googleAI()],
    });
    // console.info("Genkit AI initialized (potentially using ADC or free tier for googleAI).");
  }
} catch (error: any) {
  console.error(
    "CRITICAL Genkit AI Initialization Error:",
    error.message,
    error.stack,
    "This often indicates a missing or invalid server-side API key (e.g., GOOGLE_API_KEY or GEMINI_API_KEY for the googleAI plugin if required for your models/setup) or a misconfiguration of Application Default Credentials (ADC). Please check your server environment variables. AI features will be unavailable."
  );
  // Provide a stub that allows the app to load but AI features will fail.
  aiInstance = {
    defineFlow: (config: any, handler: any) => {
      console.warn(`Genkit AI STUB (init error): defineFlow called for ${config.name}. AI not initialized.`);
      return async (input: any) => {
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) failed to initialize. Flow '${config.name}' cannot run. Check server logs for Genkit/GoogleAI configuration issues, especially server-side API keys.`,
        });
      };
    },
    definePrompt: (config: any) => {
      console.warn(`Genkit AI STUB (init error): definePrompt called for ${config.name}. AI not initialized.`);
      return async (input: any) => {
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) failed to initialize. Prompt '${config.name}' cannot run.`,
        });
      };
    },
    generate: async (options: ModelArgument) => {
      console.error("Genkit AI STUB (init error): generate called. AI not initialized. Options:", options.prompt);
      throw new GenkitError({
        source: 'genkit-stub',
        status: 'UNAVAILABLE',
        message: `AI service (Genkit) failed to initialize. Generation for prompt '${options.prompt}' cannot run.`,
      });
    },
    defineSchema: (name: string, schema: any) => {
        console.warn(`Genkit AI STUB (init error): defineSchema called for ${name}. AI not initialized.`);
        return schema;
    },
    embed: async (options: any) => {
        console.warn(`Genkit AI STUB (init error): embed called. AI not initialized.`);
        throw new GenkitError({
          source: 'genkit-stub',
          status: 'UNAVAILABLE',
          message: `AI service (Genkit) failed to initialize. Embedding cannot run.`,
        });
    }
  };
}

export const ai = aiInstance;
