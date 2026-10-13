import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output, type LanguageModel } from 'ai';
import { extractionSchema, type ExtractionProvider } from '../core/invoice';
import { extractionInstructions } from './prompt';

/** Any AI SDK model that accepts PDF/image file parts; injected for tests. */
export function aiSdkProvider(
  model: LanguageModel,
  id: string,
): ExtractionProvider {
  return {
    id,
    async extract(file, signal) {
      const result = await generateText({
        model,
        maxRetries: 0,
        maxOutputTokens: 4000,
        abortSignal: signal,
        output: Output.object({ schema: extractionSchema }),
        system: extractionInstructions,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file', data: file.bytes, mediaType: file.mediaType },
              { type: 'text', text: 'この請求書の値を抽出してください。' },
            ],
          },
        ],
      });
      return {
        value: result.output,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      };
    },
  };
}

export function claudeProvider(
  apiKey: string,
  modelId: string,
): ExtractionProvider {
  return aiSdkProvider(
    createAnthropic({ apiKey })(modelId),
    `claude:${modelId}`,
  );
}
