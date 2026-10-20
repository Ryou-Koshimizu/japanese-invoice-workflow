import type {
  Extraction,
  ExtractionProvider,
  InvoiceFile,
  Usage,
} from '../core/invoice';
import { AppError } from '../server/db';

/** Failures worth one more try: the model hung, or answered nothing usable. */
const transient = (e: unknown) =>
  !(e instanceof AppError) &&
  /TIMEOUT|INCOMPLETE|INFERENCE_FAILED|UNEXPECTED_ITEM|JSON|ECONNRESET|overloaded|5\d\d/i.test(
    (e as Error)?.message ?? '',
  );

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
 * accuracy eval alike:
 * - a call that times out or returns nothing usable is retried once;
 * - a registration number that is not "T" + 13 digits is read once more, and
 *   the second reading is kept only if it has the right shape. A misprinted
 *   number reads the same twice, so the rule still reports it.
 */
export function reliable(provider: ExtractionProvider): ExtractionProvider {
  const once = async (file: InvoiceFile, signal?: AbortSignal) => {
    try {
      return await provider.extract(file, signal);
    } catch (e) {
      if (signal?.aborted || !transient(e)) throw e;
      return provider.extract(file, signal);
    }
  };
  return {
    id: provider.id,
    async extract(file, signal) {
      const first = await once(file, signal);
      if (!unreadable(first.value)) return first;
      const second = await once(file, signal).catch(() => null);
      if (!second) return first;
      const usage = add(first.usage, second.usage);
      return unreadable(second.value)
        ? { value: first.value, usage }
        : { value: second.value, usage };
    },
  };
}
