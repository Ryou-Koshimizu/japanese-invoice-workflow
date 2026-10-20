import { FlaskConical } from 'lucide-react';
import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listInvoices } from '../../src/server/service';
import { roleLabels } from '../../src/core/invoice';
import HeaderMenu from './nav';
import {
  LogoutButton,
  LogoutIconButton,
  ResetDemoButton,
} from './session-buttons';

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
    <>
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <header className="topbar" data-open="false">
        <div className="topbar-inner">
          <a className="brand" href="/">
            <span className="seal" aria-hidden="true">
              請
            </span>
            <span>
              <b>請求書AIワークフロー</b>
              <small>{s.orgName}</small>
            </span>
          </a>
          <HeaderMenu role={s.role} todo={mine}>
            <div className="who">
              <div className="who-card">
                <b>{s.userName}</b>
                <span className="who-email">{s.email}</span>
                <span className="role-chip">{roleLabels[s.role]}</span>
              </div>
              <LogoutIconButton />
            </div>
          </HeaderMenu>
        </div>
      </header>
      <main className="main" id="main">
        {config.mode === 'demo' && (
          <div className="demo-bar" role="note">
            <b>
              <FlaskConical className="icon" aria-hidden="true" />
              公開デモ
            </b>
            <span>
              AIは呼び出さず、同梱のサンプル請求書には事前に用意した読み取り結果（正解データから作成）を使います。
              {config.sharedDatabase
                ? 'データは1日ごと、または「デモを初期化」で元に戻ります。'
                : 'データはサーバーの再起動で初期化されます。'}
            </span>
            <span className="demo-actions">
              <LogoutButton label="別の役割でログイン" />
              {s.role === 'admin' && <ResetDemoButton />}
            </span>
          </div>
        )}
        {children}
      </main>
    </>
  );
}
