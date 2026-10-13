import { route } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { uploadInvoice } from '../../../src/server/service';
import { AppError } from '../../../src/server/db';

export const POST = route(async (s, request) => {
  if (Number(request.headers.get('content-length') ?? 0) > 11 * 1024 * 1024)
    throw new AppError(413, 'ファイルは10MBまでです。');
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File))
    throw new AppError(400, 'ファイルを選んでください。');
  const { deps } = await runtime();
  const id = await uploadInvoice(
    deps,
    s,
    file.name,
    new Uint8Array(await file.arrayBuffer()),
  );
  return Response.json({ id }, { status: 201 });
});
