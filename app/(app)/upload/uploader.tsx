'use client';
import { useRef, useState } from 'react';

type Sample = { file: string; vendor: string; group: string; note?: string };

export default function Uploader({
  demo,
  samples,
}: {
  demo: boolean;
  samples: Sample[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function upload(file: File, extract: boolean) {
    setError('');
    setStatus(`${file.name} をアップロードしています…`);
    const form = new FormData();
    form.append('file', file);
    const r = await fetch('/api/invoices', { method: 'POST', body: form });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStatus('');
      setError(json.error ?? 'アップロードに失敗しました。');
      return;
    }
    if (extract) {
      setStatus('AIで読み取っています…');
      const x = await fetch(`/api/invoices/${json.id}/extract`, {
        method: 'POST',
      });
      if (!x.ok)
        setError(
          ((await x.json().catch(() => ({}))) as { error?: string }).error ??
            '読み取りに失敗しました。',
        );
    }
    window.location.assign(`/invoices/${json.id}`);
  }

  async function useSample(name: string) {
    // Same pattern the server enforces: only the bundled sample files.
    if (!/^inv-\d{2}\.(pdf|png|jpg)$/.test(name)) return;
    const r = await fetch(`/api/samples/${encodeURIComponent(name)}`);
    const blob = await r.blob();
    await upload(new File([blob], name, { type: blob.type }), true);
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        className={`drop${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="ファイルを選択、またはここにドロップ"
        onClick={() => input.current?.click()}
        onKeyDown={(e) =>
          (e.key === 'Enter' || e.key === ' ') && input.current?.click()
        }
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f, true);
        }}
      >
        <b style={{ fontSize: 17 }}>ここに請求書をドロップ</b>
        <p className="sub">
          またはクリックしてファイルを選択。アップロード後、自動でAIが読み取ります。
        </p>
        <input
          ref={input}
          type="file"
          hidden
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f, true);
          }}
        />
      </div>
      {status && (
        <div className="notice" role="status">
          {status}
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <section>
        <h2>サンプル請求書で試す</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 12 }}>
          {demo
            ? '公開デモで読み取れるのは同梱のサンプルだけです。すべて架空の会社・番号です。'
            : '評価用の架空の請求書です。実AIでの読み取りを試せます。'}
        </p>
        <div className="samples">
          {samples.map((s) => (
            <div key={s.file} className="card sample">
              <span>
                <b>{s.vendor}</b>
                <small>
                  {s.group}
                  {s.note ? `：${s.note}` : ''}
                </small>
              </span>
              <span className="actions">
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => useSample(s.file)}
                  aria-label={`${s.vendor}のサンプルを登録して読み取る`}
                >
                  試す
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
