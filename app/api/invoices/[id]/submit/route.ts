import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { submitInvoice } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 5000);
  const { deps } = await runtime();
  await submitInvoice(deps, s, id, String(body.note ?? ''));
  return Response.json({ ok: true });
});
