import { Inbox } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="login-wrap" style={{ minHeight: '100svh' }}>
      <div className="card pad rise" style={{ textAlign: 'center' }}>
        <h1>ページが見つかりません</h1>
        <p className="sub" style={{ marginBottom: 16 }}>
          権限がないか、存在しない請求書です。
        </p>
        <a className="btn primary" href="/">
          <Inbox className="icon" aria-hidden="true" />
          請求書一覧へ
        </a>
      </div>
    </main>
  );
}
