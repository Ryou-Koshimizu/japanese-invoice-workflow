import { redirect } from 'next/navigation';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { listInvoices, exportBatches } from '../../../src/server/service';
import { yen, jstDateTime } from '../../../src/ui/format';
import ExportButton from './export-button';

export const dynamic = 'force-dynamic';

export default async function ExportPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const { invoices } = await listInvoices(deps, s);
  const approved = invoices.filter((i) => i.status === 'approved');
  const batches = await exportBatches(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>仕訳CSV出力</h1>
          <p className="sub">
            承認済みの請求書を仕訳形式のCSVにまとめて出力します。出力した請求書は以後編集できません（二重計上の防止）。
          </p>
        </div>
        <ExportButton count={approved.length} />
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <table className="list">
          <thead>
            <tr>
              <th>発行者</th>
              <th>請求日</th>
              <th className="right">請求金額</th>
            </tr>
          </thead>
          <tbody>
            {approved.length ? (
              approved.map((i) => (
                <tr key={i.id}>
                  <td>
                    <a className="row-link" href={`/invoices/${i.id}`}>
                      {i.vendor}
                    </a>
                  </td>
                  <td className="num">{i.issue_date}</td>
                  <td className="right num">{yen(i.total)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="empty">
                  出力待ちの承認済み請求書はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2>出力履歴</h2>
      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>出力日時</th>
              <th>出力者</th>
              <th className="right">件数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {batches.length ? (
              batches.map((b) => (
                <tr key={b.id}>
                  <td>{jstDateTime(b.created_at)}</td>
                  <td>{b.creator}</td>
                  <td className="right num">{b.invoice_count}</td>
                  <td className="right">
                    <a href={`/api/export/${b.id}`}>再ダウンロード</a>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="empty">
                  まだ出力していません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
