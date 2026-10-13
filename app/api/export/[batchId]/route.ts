import { route } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { batchCsv } from '../../../../src/server/service';
import { AppError } from '../../../../src/server/db';

type Ctx = { params: Promise<{ batchId: string }> };
export const GET = route(async (s, _request, { params }: Ctx) => {
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(batchId))
    throw new AppError(404, '見つかりません。');
  const { deps } = await runtime();
  const csv = await batchCsv(deps, s, batchId);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-${batchId.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
