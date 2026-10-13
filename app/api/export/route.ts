import { route } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { exportApproved } from '../../../src/server/service';

const csvResponse = (csv: string, name: string) =>
  new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });

export const POST = route(async (s) => {
  const { deps } = await runtime();
  const result = await exportApproved(deps, s);
  return csvResponse(result.csv, `journal-${result.batchId.slice(0, 8)}.csv`);
});
