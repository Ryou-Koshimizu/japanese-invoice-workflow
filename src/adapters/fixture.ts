import type { Extraction, ExtractionProvider } from '../core/invoice';
import { AppError } from '../server/db';
import fixtures from '../../fixtures/demo-extractions.json';

type FixtureFile = {
  sha256: string;
  file: string;
  extraction: Extraction;
  note?: string;
}[];

const known = new Set((fixtures as FixtureFile).map((f) => f.sha256));

/** Public demo: only the bundled fictional sample invoices are accepted. */
export const isDemoSample = (sha256: string) => known.has(sha256);

/**
 * Public demo provider: returns prepared extraction results for the bundled
 * sample invoices, keyed by file hash. It makes no AI call; results are
 * labelled as demo data in the UI and are never counted as AI accuracy.
 */
export function fixtureProvider(
  entries: FixtureFile = fixtures as FixtureFile,
): ExtractionProvider {
  const table = new Map(entries.map((f) => [f.sha256, f.extraction]));
  return {
    id: 'demo-fixture',
    async extract(file) {
      const hit = table.get(file.sha256);
      if (!hit)
        throw new AppError(
          422,
          '公開デモでは、同梱のサンプル請求書だけを読み取れます。自分の請求書は実運用モードで試してください。',
          'DEMO_UNKNOWN_FILE',
        );
      return {
        value: structuredClone(hit),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
