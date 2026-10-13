import { route } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { extractInvoice } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(115_000),
  ]);
  const result = await extractInvoice(deps, s, id, signal);
  return Response.json({ issues: result.issues });
});
