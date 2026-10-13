import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { aiSdkProvider } from '../src/adapters/claude';
import { parseCodexOutput } from '../src/adapters/codex';

const truth = JSON.parse(readFileSync('eval/cases.json', 'utf8')).cases[0]
  .truth;
const result = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: 'end_turn' },
  usage: {
    inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 300, text: 300, reasoning: 0 },
  },
  warnings: [],
});

it('sends the PDF as a file part with the instructions and validates the output', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: result(
      JSON.stringify({ ...truth, uncertain: [], accountHint: '通信費' }),
    ),
  });
  const provider = aiSdkProvider(model, 'mock');
  const bytes = new Uint8Array(readFileSync('eval/invoices/inv-01.pdf'));
  const out = await provider.extract({
    bytes,
    mediaType: 'application/pdf',
    sha256: 'x',
    name: 'inv-01.pdf',
  });
  expect(out.value.totalAmount).toBe(truth.totalAmount);
  expect(out.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
  const call = model.doGenerateCalls[0];
  expect(JSON.stringify(call.prompt[0])).toContain('請求書から値を読み取る');
  const user = call.prompt[1] as {
    content: { type: string; mediaType?: string }[];
  };
  expect(user.content[0]).toMatchObject({
    type: 'file',
    mediaType: 'application/pdf',
  });
});

it('rejects output that does not match the schema instead of guessing', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: result(
      JSON.stringify({
        ...truth,
        totalAmount: '12,000円',
        uncertain: [],
        accountHint: null,
      }),
    ),
  });
  const provider = aiSdkProvider(model, 'mock');
  await expect(
    provider.extract({
      bytes: new Uint8Array([1]),
      mediaType: 'image/png',
      sha256: 'x',
      name: 'x.png',
    }),
  ).rejects.toBeTruthy();
});

it('accepts only the final structured Codex message and usage', () => {
  const ok = [
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '{"a":1}' },
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
  ].join('\n');
  expect(parseCodexOutput(ok)).toEqual({
    value: { a: 1 },
    usage: { inputTokens: 5, outputTokens: 2 },
  });
  const tool = JSON.stringify({
    type: 'item.started',
    item: { type: 'command_execution' },
  });
  expect(() => parseCodexOutput(tool)).toThrow(/CODEX_UNEXPECTED_ITEM/);
});
