import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { currentSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { demoUsers, DEMO_PASSWORD } from '../../src/server/demo-seed';
import { roleLabels } from '../../src/core/invoice';
import LoginForm, { EmailLogin } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/');
  const { config } = await runtime();
  const demo = config.mode === 'demo';
  const users = demo
    ? demoUsers.map((u) => ({ ...u, roleLabel: roleLabels[u.role] }))
    : [];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/login">
            <span className="seal" aria-hidden="true">
              請
            </span>
            <span>
              <b>請求書AIワークフロー</b>
              <small>読み取りから仕訳まで</small>
            </span>
          </a>
        </div>
      </header>
      <main id="main">
        {demo ? (
          <section className="hero" aria-labelledby="hero-heading">
            <div className="hero-copy">
              <h1 id="hero-heading" className="rise">
                <span className="phrase">請求書を</span>
                <span className="phrase">
                  <em>読んで、</em>
                </span>
                <span className="phrase">
                  <em>確かめて、</em>
                </span>
                <span className="phrase">承認と</span>
                <span className="phrase">仕訳まで。</span>
              </h1>
              <p
                className="lead rise"
                style={{ '--i': 1 } as React.CSSProperties}
              >
                架空の「株式会社サンプル商事」の経理部です。役割を選ぶと、そのままログインします。サンプルには事前に用意した読み取り結果（正解データから作成）を使い、AIは呼び出しません。
              </p>
              <LoginForm demoPassword={DEMO_PASSWORD} demoUsers={users} />
              <div className="hero-links">
                <a href="#email-login">メールアドレスでログイン</a>
              </div>
            </div>
            <div className="showcase" aria-hidden="true">
              <div className="sc-paper">
                <div className="sc-title">請求書</div>
                <div className="sc-row">
                  <span>株式会社アオバ通信</span>
                  <span>T5628…</span>
                </div>
                <div className="sc-row">
                  <span>通信回線 月額</span>
                  <span className="num">¥185,680</span>
                </div>
                <div className="sc-row">
                  <span>消費税 10%</span>
                  <span className="num">¥18,568</span>
                </div>
                <div className="sc-row">
                  <span>ご請求金額</span>
                  <b className="num">¥204,248</b>
                </div>
                <div className="scan" />
              </div>
              {['登録番号', '税額の計算', '合計'].map((label) => (
                <span className="sc-chip" key={label}>
                  <span className="mark">
                    <Check className="icon" />
                  </span>
                  {label}
                </span>
              ))}
              <span className="stamp">承認</span>
            </div>
          </section>
        ) : (
          <div className="login-wrap">
            <div className="card pad" style={{ width: 'min(460px, 100%)' }}>
              <h1 style={{ marginBottom: 14 }}>ログイン</h1>
              <EmailLogin />
            </div>
          </div>
        )}
        {demo && (
          <section
            className="email-login"
            id="email-login"
            aria-labelledby="email-heading"
          >
            <div className="card pad">
              <h2 id="email-heading" style={{ margin: 0 }}>
                メールアドレスでログイン
              </h2>
              <p className="sub" style={{ margin: 0 }}>
                デモのパスワード：<code>{DEMO_PASSWORD}</code>
                （メールは {users.map((u) => u.email).join(' / ')}）
              </p>
              <EmailLogin />
            </div>
          </section>
        )}
      </main>
    </>
  );
}
