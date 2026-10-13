import { route } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import { getFile } from '../../../../../src/server/service';

type Ctx = { params: Promise<{ id: string }> };
export const GET = route(async (s, _request, { params }: Ctx) => {
  const { id } = await params;
  const { deps } = await runtime();
  const f = await getFile(deps, s, id);
  return new Response(f.bytes, {
    headers: {
      'Content-Type': f.type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
