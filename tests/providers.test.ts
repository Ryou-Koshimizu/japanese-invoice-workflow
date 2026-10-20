import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { aiSdkProvider } from '../src/adapters/claude';
import { parseCodexOutput } from '../src/adapters/codex';
import { reliable } from '../src/adapters/reliable';
import { AppError } from '../src/server/db';

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

describe('reliable provider', () => {
  const file = {
    bytes: new Uint8Array([1]),
    mediaType: 'image/png' as const,
    sha256: 'x',
    name: 'inv.png',
  };
  const usage = { inputTokens: 10, outputTokens: 2 };
  const reading = (registrationNumber: string) =>
    ({ value: { registrationNumber }, usage }) as never;
  const fake = (...steps: (string | Error)[]) => {
    let n = 0;
    return {
      calls: () => n,
      provider: {
        id: 'fake',
        async extract() {
          const step = steps[n++];
          if (step === undefined) throw new Error('UNEXPECTED_THIRD_CALL');
          if (step instanceof Error) throw step;
          return reading(step);
        },
      },
    };
  };

  it('retries a timed-out call once', async () => {
    const f = fake(new Error('CODEX_TIMEOUT'), 'T7000012050002');
    const r = await reliable(f.provider).extract(file);
    expect(r.value.registrationNumber).toBe('T7000012050002');
    expect(f.calls()).toBe(2);
  });
  it('retries only exact transient codes, never refusals or look-alikes', async () => {
    for (const e of [
      new AppError(422, 'PDF不可'),
      new Error('CODEX_RATE_LIMIT'),
      new Error('CODEX_AUTH_FAILED'),
      new Error('not CODEX_TIMEOUT really'),
      new Error('Unexpected token in JSON'),
    ]) {
      const f = fake(e, 'T7000012050002');
      await expect(reliable(f.provider).extract(file)).rejects.toBe(e);
      expect(f.calls(), e.message).toBe(1);
    }
  });
  it('re-reads a malformed registration number and keeps the well-formed one', async () => {
    const f = fake('T700001205002', 'T7000012050002');
    const r = await reliable(f.provider).extract(file);
    expect(r.value.registrationNumber).toBe('T7000012050002');
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 4 });
  });
  it('keeps a misprinted number that reads the same twice, so the rule reports it', async () => {
    const f = fake('T945297698399', 'T945297698399');
    const r = await reliable(f.provider).extract(file);
    expect(r.value.registrationNumber).toBe('T945297698399');
    expect(f.calls()).toBe(2);
  });
  it('reads once when the number is well-formed', async () => {
    const f = fake('T7000012050002');
    await reliable(f.provider).extract(file);
    expect(f.calls()).toBe(1);
  });
  it('makes at most two upstream calls per extract, even after a retry', async () => {
    const f = fake(
      new Error('CODEX_TIMEOUT'),
      'T700001205002',
      'T7000012050002',
    );
    const r = await reliable(f.provider).extract(file);
    expect(r.value.registrationNumber).toBe('T700001205002');
    expect(f.calls()).toBe(2);
    const g = fake(new Error('CODEX_TIMEOUT'), new Error('CODEX_TIMEOUT'));
    await expect(reliable(g.provider).extract(file)).rejects.toThrow(
      'CODEX_TIMEOUT',
    );
    expect(g.calls()).toBe(2);
  });
  it('asks the read budget before every extra call and stops when it is used up', async () => {
    let asked = 0;
    const denied = { anotherCall: async () => (asked++, false) };
    const f = fake('T700001205002', 'T7000012050002');
    const r = await reliable(f.provider).extract(file, undefined, denied);
    expect(r.value.registrationNumber).toBe('T700001205002');
    expect([f.calls(), asked]).toEqual([1, 1]);
    const g = fake(new Error('CODEX_TIMEOUT'), 'T7000012050002');
    await expect(
      reliable(g.provider).extract(file, undefined, denied),
    ).rejects.toThrow('CODEX_TIMEOUT');
    expect([g.calls(), asked]).toEqual([1, 2]);
  });
});
