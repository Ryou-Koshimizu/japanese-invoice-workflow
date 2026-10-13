export default function NotFound() {
  return (
    <main className="login-wrap">
      <div className="card pad" style={{ textAlign: 'center' }}>
        <h1>ページが見つかりません</h1>
        <p className="sub">権限がないか、存在しない請求書です。</p>
        <a className="btn" href="/">
          請求書一覧へ
        </a>
      </div>
    </main>
  );
}
