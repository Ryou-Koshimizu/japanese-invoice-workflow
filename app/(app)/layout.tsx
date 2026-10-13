import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listInvoices } from '../../src/server/service';
import { roleLabels } from '../../src/core/invoice';
import Nav from './nav';
import { LogoutButton, ResetDemoButton } from './session-buttons';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await pageSession();
  const { config, deps } = await runtime();
  const { invoices } = await listInvoices(deps, s);
  const mine = invoices.filter((i) =>
    s.role === 'member'
      ? ['uploaded', 'reviewing', 'rejected'].includes(i.status)
      : i.status === 'submitted' && i.submitted_by !== s.userId,
  ).length;
  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <aside className="side">
        <a className="brand" href="/">
          <span className="seal">請</span>
          <span>
            <b>請求書AIワークフロー</b>
            <small>{s.orgName}</small>
          </span>
        </a>
        <Nav role={s.role} todo={mine} />
        <div className="who">
          <b>{s.userName}</b>
          {s.email}
          <br />
          <span className="role-chip">{roleLabels[s.role]}</span>
          <br />
          <LogoutButton />
        </div>
      </aside>
      <main className="main" id="main">
        {config.mode === 'demo' && (
          <div className="demo-bar" role="note">
            <b>公開デモ</b>
            <span>
              AIは呼び出さず、サンプル請求書は事前に用意した読み取り結果を使います。データはサーバー再起動で初期化されます。
            </span>
            <LogoutButton label="別の役割でログイン" />
            {s.role === 'admin' && <ResetDemoButton />}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
