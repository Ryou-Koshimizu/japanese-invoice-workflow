import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  Hourglass,
  PenLine,
  TriangleAlert,
  Wallet,
  Gauge,
} from 'lucide-react';
import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listInvoices } from '../../src/server/service';
import { statuses, statusLabels, type Status } from '../../src/core/invoice';
import { yen, jstDateTime } from '../../src/ui/format';
import CountUp from '../../src/ui/count-up';

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
  type Row = (typeof invoices)[number];
  const status = (i: Row) => (
    <span className={`status s-${i.status}`}>{statusLabels[i.status]}</span>
  );
  const flags = (i: Row) => (
    <span className="flags">
      {i.errors > 0 && (
        <span className="flag e">
          <CircleAlert className="icon" aria-hidden="true" />
          エラー {i.errors}
        </span>
      )}
      {i.warnings > 0 && (
        <span className="flag w">
          <TriangleAlert className="icon" aria-hidden="true" />
          警告 {i.warnings}
        </span>
      )}
      {i.status !== 'uploaded' && !i.errors && !i.warnings && (
        <span className="flag ok">
          <CircleCheck className="icon" aria-hidden="true" />
          問題なし
        </span>
      )}
    </span>
  );
  const metrics = [
    {
      label: '確認・修正が必要',
      value: count('uploaded') + count('reviewing') + count('rejected'),
      unit: '件',
      Icon: PenLine,
    },
    {
      label: s.role === 'member' ? '承認待ち' : 'あなたの承認待ち',
      value: s.role === 'member' ? count('submitted') : waiting,
      unit: '件',
      Icon: Hourglass,
    },
    {
      label: '承認済み（未出力）の合計',
      value: approvedTotal,
      yen: true,
      Icon: Wallet,
    },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>請求書一覧</h1>
          <p className="sub">
            エラーと警告がある項目だけ確認すれば済むように並べています。
          </p>
        </div>
        <a className="btn primary" href="/upload">
          <CloudUpload className="icon" aria-hidden="true" />
          請求書をアップロード
        </a>
      </div>
      <div className="metrics">
        {metrics.map((m, n) => (
          <div
            key={m.label}
            className="metric rise"
            style={{ '--i': n } as React.CSSProperties}
          >
            <span className="bubble" aria-hidden="true">
              <m.Icon className="icon" />
            </span>
            <small>{m.label}</small>
            <b>
              <CountUp value={m.value} format={m.yen ? 'yen' : 'int'} />
              {m.unit && <span className="unit">{m.unit}</span>}
            </b>
          </div>
        ))}
        <div
          className="metric rise"
          style={{ '--i': 3 } as React.CSSProperties}
        >
          <span className="bubble" aria-hidden="true">
            <Gauge className="icon" />
          </span>
          <small>今月の処理枚数</small>
          <b>
            <CountUp value={used} />
            <span className="unit"> 枚</span>
          </b>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </div>
          <span className="meta-line" style={{ color: 'var(--ink-2)' }}>
            {s.plan === 'pro' ? 'Pro' : 'Free'}プラン・上限
            {limit.toLocaleString('ja-JP')}枚
          </span>
        </div>
      </div>
      <div
        className="card list-card rise"
        style={{ '--i': 4 } as React.CSSProperties}
      >
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
                  <th className="hide-sm">状態</th>
                  <th>発行者 / ファイル</th>
                  <th className="hide-sm">請求日</th>
                  <th className="right">請求金額</th>
                  <th className="hide-sm">検証</th>
                  <th className="hide-sm">登録者</th>
                  <th className="hide-sm">更新</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i, n) => (
                  <tr key={i.id} style={{ '--i': n } as React.CSSProperties}>
                    <td className="hide-sm">{status(i)}</td>
                    <td>
                      <a className="row-link" href={`/invoices/${i.id}`}>
                        {i.vendor ?? '（未読み取り）'}
                        <ChevronRight className="icon" aria-hidden="true" />
                      </a>
                      <div className="meta-line">{i.file_name}</div>
                      {/* Narrow screens fold the state and checks in here. */}
                      <div className="row-meta show-sm">
                        {status(i)}
                        {flags(i)}
                      </div>
                    </td>
                    <td className="hide-sm num">{i.issue_date ?? '—'}</td>
                    <td className="right num">{yen(i.total)}</td>
                    <td className="hide-sm">{flags(i)}</td>
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
          <div className="empty">この状態の請求書は0件です。</div>
        )}
      </div>
    </>
  );
}
