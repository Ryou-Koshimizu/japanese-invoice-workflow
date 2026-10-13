import { notFound } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { getInvoice } from '../../../../src/server/service';
import { AppError } from '../../../../src/server/db';
import { accounts } from '../../../../src/core/accounts';
import Review from './review';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await pageSession();
  const { deps, config } = await runtime();
  const { id } = await params;
  let result;
  try {
    result = await getInvoice(deps, s, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  return (
    <Review
      invoice={JSON.parse(JSON.stringify(result.invoice))}
      audit={JSON.parse(JSON.stringify(result.audit))}
      me={{ userId: s.userId, role: s.role }}
      accounts={[...accounts]}
      demo={config.mode === 'demo'}
    />
  );
}
