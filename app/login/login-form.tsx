'use client';
import { useState } from 'react';
import {
  ArrowRight,
  CloudUpload,
  LogIn,
  Stamp,
  FileSpreadsheet,
} from 'lucide-react';

type DemoUser = { email: string; name: string; roleLabel: string };
const duties: Record<string, string> = {
  担当者: '請求書をアップロードし、確認して承認依頼',
  承認者: '依頼された請求書を承認・差し戻し',
  管理者: '仕訳CSVの出力、メンバーとプランの管理',
};
const faces: Record<string, typeof Stamp> = {
  担当者: CloudUpload,
  承認者: Stamp,
  管理者: FileSpreadsheet,
};

async function login(email: string, password: string) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok)
    throw new Error((await r.json()).error ?? 'ログインできませんでした。');
  window.location.assign('/');
}

/** Demo: one clay button per role signs straight in. */
export default function LoginForm({
  demoPassword,
  demoUsers,
}: {
  demoPassword: string;
  demoUsers: DemoUser[];
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        className="demo-users"
        role="group"
        aria-label="役割を選んでログイン"
      >
        {demoUsers.map((u, n) => {
          const Face = faces[u.roleLabel] ?? LogIn;
          return (
            <button
              key={u.email}
              type="button"
              className="demo-user"
              style={{ '--i': n } as React.CSSProperties}
              disabled={!!busy}
              onClick={async () => {
                setBusy(u.email);
                setError('');
                try {
                  await login(u.email, demoPassword);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy('');
                }
              }}
            >
              <span className="face" aria-hidden="true">
                <Face className="icon" />
              </span>
              <span className="who-text">
                <b>
                  {u.name}（{u.roleLabel}）
                </b>
                <small>{duties[u.roleLabel]}</small>
              </span>
              <ArrowRight className="icon go" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function EmailLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await login(email, password);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
      style={{ display: 'grid', gap: 12 }}
      aria-label="メールアドレスでログイン"
    >
      <div className="field">
        <label htmlFor="email">メールアドレス</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">パスワード</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary" disabled={busy} type="submit">
        <LogIn className="icon" aria-hidden="true" />
        ログイン
      </button>
    </form>
  );
}
