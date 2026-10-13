import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { decideInvoice } from '../../../../../src/server/service';
import { AppError } from '../../../../../src/server/db';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 5000);
  if (body.decision !== 'approve' && body.decision !== 'reject')
    throw new AppError(400, '判断が正しくありません。');
  const { deps } = await runtime();
  await decideInvoice(deps, s, id, body.decision, String(body.reason ?? ''));
  return Response.json({ ok: true });
});
