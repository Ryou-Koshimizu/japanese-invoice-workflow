'use client';

export function LogoutButton({ label = 'ログアウト' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      {label}
    </button>
  );
}

export function ResetDemoButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        if (!confirm('デモのデータを初期状態に戻します。よろしいですか？'))
          return;
        await fetch('/api/demo/reset', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      デモを初期化
    </button>
  );
}
