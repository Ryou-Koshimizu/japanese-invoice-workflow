'use client';
import { LogOut, RotateCcw, UsersRound } from 'lucide-react';

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}

export function LogoutButton({ label = 'ログアウト' }: { label?: string }) {
  return (
    <button type="button" onClick={logout}>
      <UsersRound className="icon" aria-hidden="true" /> {label}
    </button>
  );
}

/** The round clay button in the header. */
export function LogoutIconButton() {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={logout}
      title="ログアウト"
    >
      <LogOut className="icon" aria-hidden="true" />
      <span className="sr-only">ログアウト</span>
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
      <RotateCcw className="icon" aria-hidden="true" /> デモを初期化
    </button>
  );
}
