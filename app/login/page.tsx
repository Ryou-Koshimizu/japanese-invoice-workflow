import { redirect } from 'next/navigation';
import { currentSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { demoUsers, DEMO_PASSWORD } from '../../src/server/demo-seed';
import { roleLabels } from '../../src/core/invoice';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/');
  const { config } = await runtime();
  const demo = config.mode === 'demo';
  return (
    <main className="login-wrap">
      <div className="login card pad">
        <div
          className="brand"
          style={{ color: 'var(--ink)', padding: 0, marginBottom: 18 }}
        >
          <span className="seal">請</span>
          <span>
            <b>請求書AIワークフロー</b>
            <small style={{ color: 'var(--ink-3)' }}>
              読み取り・検証・承認・仕訳出力
            </small>
          </span>
        </div>
        <LoginForm
          demo={demo}
          demoPassword={demo ? DEMO_PASSWORD : undefined}
          demoUsers={
            demo
              ? demoUsers.map((u) => ({ ...u, roleLabel: roleLabels[u.role] }))
              : []
          }
        />
      </div>
    </main>
  );
}
