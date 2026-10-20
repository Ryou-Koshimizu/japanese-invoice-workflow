'use client';
import { useRef, useState } from 'react';
import { Check, CloudUpload, FlaskConical, ScanLine } from 'lucide-react';

type Sample = { file: string; vendor: string; group: string; note?: string };
type Stage = 'idle' | 'upload' | 'read' | 'check';
const stages: { key: Exclude<Stage, 'idle'>; label: string }[] = [
  { key: 'upload', label: 'アップロード' },
  { key: 'read', label: '読み取り' },
  { key: 'check', label: '検証' },
];

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
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');

  async function upload(file: File, extract: boolean) {
    setError('');
    setStage('upload');
    setStatus(`${file.name} をアップロードしています…`);
    const form = new FormData();
    form.append('file', file);
    const r = await fetch('/api/invoices', { method: 'POST', body: form });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStatus('');
      setStage('idle');
      setError(json.error ?? 'アップロードに失敗しました。');
      return;
    }
    if (extract) {
      setStage('read');
      setStatus('AIで読み取っています…');
      const x = await fetch(`/api/invoices/${json.id}/extract`, {
        method: 'POST',
      });
      if (!x.ok)
        setError(
          ((await x.json().catch(() => ({}))) as { error?: string }).error ??
            '読み取りに失敗しました。',
        );
      else {
        setStage('check');
        setStatus('インボイス制度の要件と計算を検証しました。');
      }
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

  const order = stages.findIndex((s) => s.key === stage);
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div
        className={`drop rise${over ? ' over' : ''}`}
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
        <span className="drop-icon" aria-hidden="true">
          <CloudUpload className="icon" />
        </span>
        <b>ここに請求書をドロップ</b>
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
      {stage !== 'idle' && (
        <div className="card progress">
          <div className="paper" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <div className={`scan${stage === 'check' ? '' : ' loop'}`} />
          </div>
          <div>
            <div className="round" role="status" style={{ fontWeight: 700 }}>
              {status}
            </div>
            <ol className="steps" aria-label="処理の段階">
              {stages.map((s, n) => (
                <li
                  key={s.key}
                  data-state={
                    n < order || stage === 'check'
                      ? 'done'
                      : n === order
                        ? 'now'
                        : 'todo'
                  }
                >
                  {n < order || stage === 'check' ? (
                    <Check className="icon" aria-hidden="true" />
                  ) : n === order ? (
                    <ScanLine className="icon" aria-hidden="true" />
                  ) : null}
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <section className="rise" style={{ '--i': 2 } as React.CSSProperties}>
        <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FlaskConical className="icon" aria-hidden="true" />
          サンプル請求書で試す
        </h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          {demo
            ? '公開デモで読み取れるのは同梱のサンプルです。すべて架空の会社・番号です。'
            : '評価用の架空の請求書です。実AIでの読み取りを試せます。'}
        </p>
        <div className="samples">
          {samples.map((s, n) => (
            <div
              key={s.file}
              className="card sample rise"
              style={{ '--i': n + 3 } as React.CSSProperties}
            >
              <span>
                <b>{s.vendor}</b>
                <small>
                  {s.group}
                  {s.note ? `：${s.note}` : ''}
                </small>
              </span>
              <span className="actions">
                <button
                  className="btn primary small"
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
