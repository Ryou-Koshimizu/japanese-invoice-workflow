import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { aiSdkProvider } from '../src/adapters/claude';
import { parseCodexOutput } from '../src/adapters/codex';
import { reliable, MAX_CALLS_PER_READ } from '../src/adapters/reliable';
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

describe('consensus reading (reliable provider)', () => {
  const file = {
    bytes: new Uint8Array([1]),
    mediaType: 'image/png' as const,
    sha256: 'x',
    name: 'inv.png',
  };
  const usage = { inputTokens: 10, outputTokens: 2 };
  const truth = {
    vendorName: '株式会社ナギサ不動産管理',
    registrationNumber: 'T7000012050002',
    invoiceNumber: 'A-1',
    issueDate: '2026-09-30',
    dueDate: '2026-10-31',
    recipientName: '株式会社サンプル商事',
    amountBasis: 'excluding' as const,
    taxBreakdown: [{ rate: 10 as const, base: 10000, tax: 1000 }],
    withholdingTax: 0,
    totalAmount: 11000,
    lineItems: [{ description: '作業費', amount: 10000, taxRate: 10 as const }],
    uncertain: [],
    accountHint: null,
  };
  type Step = Partial<typeof truth> | Error;
  const fake = (...steps: Step[]) => {
    let n = 0;
    return {
      calls: () => n,
      provider: {
        id: 'fake',
        async extract() {
          const step = steps[n++];
          if (step === undefined) throw new Error('UNEXPECTED_FOURTH_CALL');
          if (step instanceof Error) throw step;
          return { value: { ...truth, ...step }, usage } as never;
        },
      },
    };
  };
  const read = (f: ReturnType<typeof fake>, options?: object) =>
    reliable(f.provider).extract(file, undefined, options);

  it('reads twice and takes the value when both readings agree', async () => {
    const f = fake({}, {});
    const r = await read(f);
    expect(r.value.vendorName).toBe(truth.vendorName);
    expect(r.value.uncertain).toEqual([]);
    expect(f.calls()).toBe(2);
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 4 });
  });
  it('lets a third reading outvote a one-character slip (ナ read as サ)', async () => {
    const f = fake({ vendorName: '株式会社サギサ不動産管理' }, {}, {});
    const r = await read(f);
    expect(r.value.vendorName).toBe('株式会社ナギサ不動産管理');
    expect(r.value.uncertain).toEqual([]);
    expect(f.calls()).toBe(3);
  });
  it('flags a field for the person when no two readings agree', async () => {
    const f = fake(
      { totalAmount: 11000 },
      { totalAmount: 11001 },
      { totalAmount: 11100 },
    );
    const r = await read(f);
    expect(r.value.uncertain.map((u) => u.field)).toEqual(['totalAmount']);
  });
  it('replaces a timed-out call with the third call', async () => {
    const f = fake(new Error('CODEX_TIMEOUT'), {}, {});
    const r = await read(f);
    expect(r.value.vendorName).toBe(truth.vendorName);
    expect(f.calls()).toBe(3);
  });
  it('never retries refusals or look-alike errors', async () => {
    for (const e of [
      new AppError(422, 'PDF不可'),
      new Error('CODEX_RATE_LIMIT'),
      new Error('CODEX_AUTH_FAILED'),
      new Error('not CODEX_TIMEOUT really'),
    ]) {
      const f = fake(e, {}, {});
      await expect(read(f)).rejects.toBe(e);
      expect(f.calls(), e.message).toBe(2);
    }
  });
  it('makes at most three upstream calls per read', async () => {
    const f = fake(
      new Error('CODEX_TIMEOUT'),
      new Error('CODEX_TIMEOUT'),
      new Error('CODEX_TIMEOUT'),
      {},
    );
    await expect(read(f)).rejects.toThrow('CODEX_TIMEOUT');
    expect(f.calls()).toBe(3);
    expect(MAX_CALLS_PER_READ).toBe(3);
  });
  it('asks the read budget before every call after the first and stops when it is used up', async () => {
    let asked = 0;
    const f = fake({ vendorName: 'x' }, {}, {});
    const r = await read(f, { anotherCall: async () => (asked++, false) });
    expect([f.calls(), asked]).toEqual([1, 1]);
    expect(r.value.vendorName).toBe('x');
    let left = 1;
    const g = fake({ vendorName: 'x' }, {}, {});
    await read(g, { anotherCall: async () => left-- > 0 });
    expect(g.calls()).toBe(2);
  });
});
