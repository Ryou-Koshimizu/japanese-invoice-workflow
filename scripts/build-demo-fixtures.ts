// Builds the public demo's prepared extraction results from the eval truth.
// These are NOT model outputs. inv-29 (a scan-like image) gets one
// deliberately misread digit together with an "uncertain" flag, so the demo
// shows the review screen catching a doubtful value; every other reading is
// the truth, so no correct invoice gets a warning. See docs/adr/003.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Extraction, InvoiceData } from '../src/core/invoice';

type Manifest = {
  cases: {
    id: string;
    scanLike: boolean;
    files: { pdf?: string; image: string };
    truth: InvoiceData;
  }[];
};
const manifest: Manifest = JSON.parse(
  await readFile('eval/cases.json', 'utf8'),
);
const out = [];
for (const c of manifest.cases) {
  const extraction: Extraction = {
    ...structuredClone(c.truth),
    uncertain: [],
    accountHint: null,
  };
  let note: string | undefined;
  if (c.id === 'inv-29' && extraction.registrationNumber) {
    extraction.uncertain.push({
      field: 'registrationNumber',
      reason: '画像がかすれていて数字の判読に自信がありません。',
    });
    const r = extraction.registrationNumber;
    extraction.registrationNumber = r.slice(0, -2) + r.at(-1) + r.at(-2);
    note = 'デモ用に登録番号の末尾2桁を入れ替えた（読み取り誤りの例）';
  }
  for (const f of [c.files.pdf, c.files.image].filter(Boolean) as string[]) {
    const bytes = await readFile(join('eval/invoices', f));
    out.push({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      file: f,
      note,
      extraction,
    });
  }
}
await writeFile(
  'fixtures/demo-extractions.json',
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`Wrote ${out.length} demo extraction fixtures.`);
