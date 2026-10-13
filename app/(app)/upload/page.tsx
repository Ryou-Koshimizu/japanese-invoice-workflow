import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import Uploader from './uploader';

export const dynamic = 'force-dynamic';
const groupLabels: Record<string, string> = {
  standard: '標準（10%）',
  reduced: '軽減税率の混在',
  withholding: '源泉徴収あり',
  hard: '読み取りにくい画像',
  error: '誤りを含む',
};

export default async function UploadPage() {
  await pageSession();
  const { config } = await runtime();
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'eval/cases.json'), 'utf8'),
  ) as {
    cases: {
      id: string;
      group: string;
      note?: string;
      files: { pdf?: string; image: string };
      truth: { vendorName: string };
    }[];
  };
  const samples = manifest.cases
    .filter((c) =>
      [
        'inv-03',
        'inv-15',
        'inv-26',
        'inv-31',
        'inv-36',
        'inv-37',
        'inv-38',
      ].includes(c.id),
    )
    .map((c) => ({
      file: c.files.pdf ?? c.files.image,
      vendor: c.truth.vendorName,
      group: groupLabels[c.group],
      note: c.note,
    }));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>請求書をアップロード</h1>
          <p className="sub">
            PDF・PNG・JPEG（10MB・20ページまで）。種類はファイルの中身で判定します。
          </p>
        </div>
      </div>
      <Uploader demo={config.mode === 'demo'} samples={samples} />
    </>
  );
}
