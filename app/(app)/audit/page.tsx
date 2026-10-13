import { redirect } from 'next/navigation';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { auditLog } from '../../../src/server/service';
import { auditLabel, jstDateTime } from '../../../src/ui/format';
import { fieldLabels, type FieldName } from '../../../src/core/invoice';

export const dynamic = 'force-dynamic';

function describe(action: string, detail: Record<string, unknown>) {
  if (action === 'edit')
    return Object.keys(detail)
      .map((k) => fieldLabels[k as FieldName] ?? k)
      .join('、');
  if (action === 'account' || action === 'role')
    return `${detail.from} → ${detail.to}`;
  if (action === 'export') return `${detail.invoice_count}件`;
  if (action === 'billing') return `${detail.plan}プラン`;
  if (typeof detail.reason === 'string') return detail.reason;
  if (typeof detail.warning_note === 'string')
    return `警告確認：${detail.warning_note}`;
  return '';
}

export default async function AuditPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const rows = await auditLog(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>監査ログ</h1>
          <p className="sub">
            データベースのトリガーが記録します。アプリの権限では更新・削除できません。
          </p>
        </div>
      </div>
      <div className="card scroll-x">
        <table className="list">
          <thead>
            <tr>
              <th>日時</th>
              <th>操作</th>
              <th>実行者</th>
              <th>対象</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="meta-line">{jstDateTime(r.at)}</td>
                <td>{auditLabel(r.action)}</td>
                <td>{r.actor ?? 'システム'}</td>
                <td>
                  {r.invoice_id ? (
                    <a href={`/invoices/${r.invoice_id}`}>{r.file_name}</a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="meta-line">{describe(r.action, r.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
