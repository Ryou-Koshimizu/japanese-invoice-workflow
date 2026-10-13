import { route, readJson } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { setRole } from '../../../../src/server/service';
import type { Role } from '../../../../src/core/invoice';

type Ctx = { params: Promise<{ userId: string }> };
export const PATCH = route(async (s, request, { params }: Ctx) => {
  const { userId } = await params;
  const body = await readJson(request, 1000);
  const { deps } = await runtime();
  await setRole(deps, s, userId, String(body.role) as Role);
  return Response.json({ ok: true });
});
