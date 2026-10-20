'use client';
import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { roleLabels, type Role } from '../../../src/core/invoice';

export function MemberRole({
  userId,
  role,
  name,
}: {
  userId: string;
  role: Role;
  name: string;
}) {
  const [value, setValue] = useState(role);
  const [error, setError] = useState('');
  return (
    <span style={{ display: 'inline-grid', gap: 4 }}>
      <select
        aria-label={`${name}の役割`}
        value={value}
        onChange={async (e) => {
          const next = e.target.value as Role;
          setError('');
          const r = await fetch(`/api/members/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: next }),
          });
          if (r.ok) setValue(next);
          else
            setError(
              ((await r.json().catch(() => ({}))) as { error?: string })
                .error ?? '変更できませんでした。',
            );
        }}
      >
        {(Object.keys(roleLabels) as Role[]).map((r) => (
          <option key={r} value={r}>
            {roleLabels[r]}
          </option>
        ))}
      </select>
      {error && (
        <span
          className="hint"
          role="alert"
          style={{ color: 'var(--error)', fontSize: 12 }}
        >
          {error}
        </span>
      )}
    </span>
  );
}

export function UpgradeButton({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState('');
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <button
        className="btn primary"
        disabled={!enabled}
        onClick={async () => {
          const r = await fetch('/api/billing/checkout', { method: 'POST' });
          const json = await r.json().catch(() => ({}));
          if (r.ok && json.url) window.location.assign(json.url);
          else setError(json.error ?? '決済ページを開けませんでした。');
        }}
      >
        <CreditCard className="icon" aria-hidden="true" />
        Proプランにアップグレード（Stripe）
      </button>
      {!enabled && (
        <span className="meta-line">
          Stripeのテストモードのキーを設定すると、この画面から決済できます（設定方法はdocs/local-setup.md）。
        </span>
      )}
      {error && (
        <span className="alert" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
