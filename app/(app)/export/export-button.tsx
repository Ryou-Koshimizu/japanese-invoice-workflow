'use client';
import { useState } from 'react';

export default function ExportButton({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <button
        className="btn primary"
        disabled={!count || busy}
        onClick={async () => {
          if (
            !confirm(
              `承認済みの${count}件を出力し、出力済みとしてロックします。よろしいですか？`,
            )
          )
            return;
          setBusy(true);
          setError('');
          const r = await fetch('/api/export', { method: 'POST' });
          if (!r.ok) {
            setError(
              ((await r.json().catch(() => ({}))) as { error?: string })
                .error ?? '出力に失敗しました。',
            );
            setBusy(false);
            return;
          }
          const name =
            /filename="([^"]+)"/.exec(
              r.headers.get('content-disposition') ?? '',
            )?.[1] ?? 'journal.csv';
          const url = URL.createObjectURL(await r.blob());
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
          window.location.reload();
        }}
      >
        {busy ? '出力中…' : `${count}件をCSV出力`}
      </button>
      {error && (
        <span className="alert" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
