// Runs the configured extraction provider over the 40 fictional invoices and
// scores every field against the truth. Usage:
//   npm run eval                 # all cases
//   npm run eval -- --ids=inv-01,inv-29
// Requires EXTRACTION_PROVIDER=claude (ANTHROPIC_API_KEY, ANTHROPIC_MODEL)
// or EXTRACTION_PROVIDER=codex (CODEX_MODEL, logged-in Codex CLI).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import {
  extractionSchema,
  toInvoiceData,
  type InvoiceData,
  type ExtractionProvider,
} from '../src/core/invoice';
import { scoreCase, summarize, type CaseResult } from '../src/eval/compare';
import { extractionInstructions } from '../src/adapters/prompt';

type Case = {
  id: string;
  group: string;
  files: { pdf?: string; image: string };
  truth: InvoiceData;
  expectedIssues: string[];
};
const manifestText = await readFile('eval/cases.json', 'utf8');
const manifest: { referenceDate: string; cases: Case[] } =
  JSON.parse(manifestText);
const ids = process.argv
  .find((a) => a.startsWith('--ids='))
  ?.slice(6)
  .split(',');
const cases = ids
  ? manifest.cases.filter((c) => ids.includes(c.id))
  : manifest.cases;

const kind = process.env.EXTRACTION_PROVIDER ?? 'claude';
let provider: ExtractionProvider;
let model: string;
if (kind === 'codex') {
  const { codexProvider } = await import('../src/adapters/codex');
  model = process.env.CODEX_MODEL ?? '';
  provider = codexProvider({
    model,
    effort: (process.env.CODEX_EFFORT as never) ?? 'auto',
  });
} else if (kind === 'claude') {
  const { claudeProvider } = await import('../src/adapters/claude');
  model = process.env.ANTHROPIC_MODEL ?? '';
  provider = claudeProvider(process.env.ANTHROPIC_API_KEY ?? '', model);
} else if (kind === 'fixture') {
  // Pipeline check only: replays the demo fixtures. Never report this as AI accuracy.
  const { fixtureProvider } = await import('../src/adapters/fixture');
  model = 'demo-fixture';
  provider = fixtureProvider();
} else throw new Error('EXTRACTION_PROVIDER must be claude, codex or fixture');
if (!model) throw new Error('Set ANTHROPIC_MODEL or CODEX_MODEL');

const sha = (s: string | Buffer) =>
  createHash('sha256').update(s).digest('hex');
let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {}
await mkdir('reports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(
  'reports',
  `${kind === 'fixture' ? 'pipeline' : 'eval'}-${stamp}.json`,
);
const results: CaseResult[] = [];
let consecutiveFailures = 0;

async function save(status: 'running' | 'complete' | 'stopped') {
  await writeFile(
    out,
    JSON.stringify(
      {
        status,
        fullSuite: !ids && status === 'complete',
        provider: provider.id,
        model,
        commit,
        casesSha256: sha(manifestText),
        promptSha256: sha(extractionInstructions),
        referenceDate: manifest.referenceDate,
        timestamp: new Date().toISOString(),
        costJpy: null,
        summary: summarize(results),
        results,
      },
      null,
      2,
    ),
  );
}

for (const c of cases) {
  const name =
    kind === 'codex' ? c.files.image : (c.files.pdf ?? c.files.image);
  const bytes = new Uint8Array(await readFile(join('eval/invoices', name)));
  const mediaType = name.endsWith('.pdf')
    ? 'application/pdf'
    : name.endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';
  const started = Date.now();
  try {
    const { value, usage } = await provider.extract({
      bytes,
      mediaType,
      sha256: sha(Buffer.from(bytes)),
      name,
    });
    const data = toInvoiceData(extractionSchema.parse(value));
    results.push(
      scoreCase(
        c,
        data,
        { elapsedMs: Date.now() - started, usage },
        manifest.referenceDate,
      ),
    );
    consecutiveFailures = 0;
  } catch (e) {
    results.push(
      scoreCase(
        c,
        null,
        {
          elapsedMs: Date.now() - started,
          usage: { inputTokens: 0, outputTokens: 0 },
          error: (e as Error).message.slice(0, 200),
        },
        manifest.referenceDate,
      ),
    );
    if (++consecutiveFailures >= 3) {
      await save('stopped');
      throw new Error(
        `Stopped after 3 consecutive failures. Partial report: ${out}`,
      );
    }
  }
  const last = results.at(-1)!;
  console.log(
    `${c.id} ${
      last.error
        ? 'ERROR ' + last.error
        : last.fullyCorrect
          ? 'ok'
          : 'mismatch: ' +
            Object.entries(last.fields)
              .filter(([, v]) => !v)
              .map(([k]) => k)
              .join(',')
    } ${last.elapsedMs}ms`,
  );
  await save('running');
}
await save('complete');
const s = summarize(results);
console.log(
  JSON.stringify(
    {
      report: out,
      fullyCorrectRate: s.fullyCorrectRate,
      fieldAccuracy: s.fieldAccuracy,
      seededMistakesDetected: s.seededMistakesDetected,
      falseAlarms: s.falseAlarms,
      misreadsWithoutIssue: s.misreadsWithoutIssue,
      failedCalls: s.failedCalls,
      medianMs: s.medianMs,
    },
    null,
    2,
  ),
);
