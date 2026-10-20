import {
  fieldNames,
  type Extraction,
  type ExtractionProvider,
  type ExtractOptions,
  type Usage,
} from '../core/invoice';

/**
 * Failures worth one more try, by exact error code: the model hung, or
 * answered nothing usable. Anything else (refusals, auth, rate limits,
 * unsupported files) is final.
 */
const transientCodes = new Set([
  'CODEX_TIMEOUT',
  'CODEX_INCOMPLETE_RESPONSE',
  'CODEX_INFERENCE_FAILED',
]);
export const isTransient = (e: unknown) =>
  e instanceof Error && transientCodes.has(e.message);

/** At most this many upstream AI calls per extract(). */
export const MAX_CALLS_PER_READ = 3;

const compared = [...fieldNames, 'amountBasis'] as const;
type Compared = (typeof compared)[number];

/** Same value, ignoring spacing, width and hyphens in text. */
const key = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    typeof x === 'string' ? x.normalize('NFKC').replace(/[\s-]/g, '') : x,
  );

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/**
 * Consensus reading, used by the app and by the accuracy eval alike.
 *
 * One reading can slip on a single character (e.g. ナ read as サ) with nothing
 * else looking wrong, so the document is read twice, independently and in
 * parallel. Where the two readings agree, the value is taken. Where they
 * differ, a third reading decides by majority; a field that still has no
 * majority is kept from the first reading and flagged for the person to check
 * (AI_UNCERTAIN). A failed call (timeout, empty answer) is replaced by the
 * third call. At most three upstream calls per read, and every call after the
 * first is granted by `anotherCall()`, which the app counts against the
 * per-invoice limit enforced by the database.
 */
export function reliable(provider: ExtractionProvider): ExtractionProvider {
  return {
    id: provider.id,
    async extract(file, signal, options?: ExtractOptions) {
      let calls = 0;
      let denied = false;
      const grant = async () => {
        if (denied || calls >= MAX_CALLS_PER_READ || signal?.aborted)
          return false;
        if (calls > 0 && !(await (options?.anotherCall?.() ?? true))) {
          denied = true;
          return false;
        }
        calls++;
        return true;
      };
      type Outcome = Awaited<ReturnType<ExtractionProvider['extract']>>;
      const call = async (): Promise<Outcome | Error | null> =>
        (await grant())
          ? provider.extract(file, signal).catch((e: Error) => e)
          : null;

      const outcomes = (await Promise.all([call(), call()])).filter(
        (o) => o !== null,
      );
      let readings = outcomes.filter(
        (o): o is Outcome => !(o instanceof Error),
      );
      const errors = outcomes.filter((o): o is Error => o instanceof Error);
      for (const e of errors) if (!isTransient(e)) throw e;

      const disagree = (a: Extraction, b: Extraction) =>
        compared.filter((f) => key(a[f]) !== key(b[f]));
      if (
        readings.length < 2 ||
        disagree(readings[0].value, readings[1].value).length
      ) {
        const third = await call();
        if (third instanceof Error && !readings.length) throw third;
        if (third && !(third instanceof Error)) readings = [...readings, third];
      }
      if (!readings.length)
        throw errors[0] ?? new Error('CODEX_INCOMPLETE_RESPONSE');

      const usage = readings.reduce((u, r) => add(u, r.usage), {
        inputTokens: 0,
        outputTokens: 0,
      });
      const base = readings[0].value;
      if (readings.length === 1) return { value: base, usage };

      const value: Extraction = { ...base, uncertain: [...base.uncertain] };
      for (const f of compared) {
        const counts = new Map<string, { n: number; v: unknown }>();
        for (const r of readings) {
          const k = key(r.value[f]);
          counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, v: r.value[f] });
        }
        const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
        if (top.n >= 2) {
          (value as Record<Compared, unknown>)[f] = top.v;
        } else if (
          f !== 'amountBasis' &&
          !value.uncertain.some((u) => u.field === f)
        ) {
          value.uncertain.push({
            field: f,
            reason:
              '複数回の読み取りで値が一致しませんでした。原本で確認してください。',
          });
        }
      }
      return { value, usage };
    },
  };
}
