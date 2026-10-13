import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listInvoices } from '../../src/server/service';
import { statuses, statusLabels, type Status } from '../../src/core/invoice';
import { yen, jstDateTime } from '../../src/ui/format';

export const dynamic = 'force-dynamic';

export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const { invoices, used } = await listInvoices(deps, s);
  const filter = (await searchParams).status as Status | undefined;
  const shown =
    filter && statuses.includes(filter)
      ? invoices.filter((i) => i.status === filter)
      : invoices;
  const count = (st: Status) => invoices.filter((i) => i.status === st).length;
  const limit = s.plan === 'pro' ? 1000 : 30;
  const waiting = invoices.filter(
    (i) => i.status === 'submitted' && i.submitted_by !== s.userId,
  ).length;
  const approvedTotal = invoices
    .filter((i) => i.status === 'approved')
    .reduce((sum, i) => sum + (i.total ?? 0), 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>請求書一覧</h1>
          <p className="sub">
            AIの読み取り結果は、エラーと警告がある項目だけ確認すれば済むように表示されます。
          </p>
        </div>
        <a className="btn primary" href="/upload">
          ＋ 請求書をアップロード
        </a>
      </div>
      <div className="metrics">
        <div className="card metric">
          <small>確認・修正が必要</small>
          <b className="num">
            {count('uploaded') + count('reviewing') + count('rejected')}
          </b>
          件
        </div>
        <div className="card metric">
          <small>{s.role === 'member' ? '承認待ち' : 'あなたの承認待ち'}</small>
          <b className="num">
            {s.role === 'member' ? count('submitted') : waiting}
          </b>
          件
        </div>
        <div className="card metric">
          <small>承認済み（未出力）の合計</small>
          <b className="num">{yen(approvedTotal)}</b>
        </div>
        <div className="card metric">
          <small>
            今月の処理枚数（{s.plan === 'pro' ? 'Pro' : 'Free'}プラン）
          </small>
          <b className="num">
            {used} / {limit}
          </b>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </div>
        </div>
      </div>
      <div className="card">
        <nav className="tabs" aria-label="状態で絞り込み">
          <a href="/" aria-current={!filter ? 'page' : undefined}>
            すべて<span>{invoices.length}</span>
          </a>
          {statuses.map((st) => (
            <a
              key={st}
              href={`/?status=${st}`}
              aria-current={filter === st ? 'page' : undefined}
            >
              {statusLabels[st]}
              <span>{count(st)}</span>
            </a>
          ))}
        </nav>
        {shown.length ? (
          <div className="scroll-x">
            <table className="list">
              <thead>
                <tr>
                  <th>状態</th>
                  <th>発行者 / ファイル</th>
                  <th className="hide-sm">請求日</th>
                  <th className="right">請求金額</th>
                  <th>検証</th>
                  <th className="hide-sm">登録者</th>
                  <th className="hide-sm">更新</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className={`status s-${i.status}`}>
                        {statusLabels[i.status]}
                      </span>
                    </td>
                    <td>
                      <a className="row-link" href={`/invoices/${i.id}`}>
                        {i.vendor ?? '（未読み取り）'}
                      </a>
                      <div className="meta-line">{i.file_name}</div>
                    </td>
                    <td className="hide-sm num">{i.issue_date ?? '—'}</td>
                    <td className="right num">{yen(i.total)}</td>
                    <td>
                      <span className="flags">
                        {i.errors > 0 && (
                          <span className="flag e">エラー {i.errors}</span>
                        )}
                        {i.warnings > 0 && (
                          <span className="flag w">警告 {i.warnings}</span>
                        )}
                        {i.status !== 'uploaded' &&
                          !i.errors &&
                          !i.warnings && (
                            <span className="meta-line">問題なし</span>
                          )}
                      </span>
                    </td>
                    <td className="hide-sm">{i.uploader_name}</td>
                    <td className="hide-sm meta-line">
                      {jstDateTime(i.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">該当する請求書はありません。</div>
        )}
      </div>
    </>
  );
}
