import { route, readJson } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { saveInvoice } from '../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const PUT = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request);
  const { deps } = await runtime();
  const issues = await saveInvoice(deps, s, id, {
    data: body.data,
    account: body.account,
  });
  return Response.json({ issues });
});
