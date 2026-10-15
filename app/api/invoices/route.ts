import { createHash } from 'node:crypto';
import { route, readBody } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { uploadInvoice } from '../../../src/server/service';
import { AppError } from '../../../src/server/db';

export const POST = route(async (s, request) => {
  // 10 MB file plus multipart overhead, enforced while reading the stream.
  const body = await readBody(
    request,
    11 * 1024 * 1024,
    'ファイルは10MBまでです。',
  );
  const form = await new Response(body, {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  })
    .formData()
    .catch(() => {
      throw new AppError(400, 'リクエストの形式が正しくありません。');
    });
  const file = form.get('file');
  if (!(file instanceof File))
    throw new AppError(400, 'ファイルを選んでください。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { config, deps } = await runtime();
  if (config.mode === 'demo') {
    // The shared public demo stores and shows only the bundled fictional
    // samples, checked before any parsing.
    const { isDemoSample } = await import('../../../src/adapters/fixture');
    if (!isDemoSample(createHash('sha256').update(bytes).digest('hex')))
      throw new AppError(
        422,
        '公開デモでは、同梱のサンプル請求書だけをアップロードできます。自分の請求書は実運用モードで試してください。',
        'DEMO_UNKNOWN_FILE',
      );
  }
  const id = await uploadInvoice(deps, s, file.name, bytes);
  return Response.json({ id }, { status: 201 });
});
