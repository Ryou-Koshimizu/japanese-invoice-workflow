import type {
  Extraction,
  ExtractionProvider,
  ExtractOptions,
  Usage,
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

/** A registration number that cannot be right whatever is printed: not "T" + 13 digits. */
const unreadable = (e: Extraction) =>
  !!e.registrationNumber &&
  !/^T\d{13}$/.test(
    e.registrationNumber.normalize('NFKC').replace(/[\s-]/g, ''),
  );

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/**
 * Wraps a real AI provider with two safeguards used in production and in the
 * accuracy eval alike. One extract() makes at most two upstream calls:
 * - a call that times out or returns nothing usable is retried once;
 * - otherwise, a registration number that is not "T" + 13 digits is read once
 *   more, and the second reading is kept only if it has the right shape. A
 *   misprinted number reads the same twice, so the rule still reports it.
 * The second call happens only if `anotherCall()` grants it; the app counts it
 * against the per-invoice AI read limit enforced by the database.
 */
export function reliable(provider: ExtractionProvider): ExtractionProvider {
  return {
    id: provider.id,
    async extract(file, signal, options?: ExtractOptions) {
      const mayCallAgain = async () =>
        !signal?.aborted && (await (options?.anotherCall?.() ?? true));
      let first;
      try {
        first = await provider.extract(file, signal);
      } catch (e) {
        if (!isTransient(e) || !(await mayCallAgain())) throw e;
        return provider.extract(file, signal);
      }
      if (!unreadable(first.value) || !(await mayCallAgain())) return first;
      const second = await provider.extract(file, signal).catch(() => null);
      if (!second) return first;
      const usage = add(first.usage, second.usage);
      return unreadable(second.value)
        ? { value: first.value, usage }
        : { value: second.value, usage };
    },
  };
}
