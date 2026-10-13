'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Renders every page of a PDF to canvas with pdf.js, so the original shows the
 * same on desktop, mobile Safari and headless browsers (no plugin needed).
 */
export default function PdfViewer({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const task = pdfjs.getDocument({ url, withCredentials: true });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const el = host.current;
        if (!el || cancelled) return;
        el.replaceChildren();
        const width = el.clientWidth || 600;
        for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale =
            (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.display = 'block';
          canvas.style.marginBottom = '8px';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title} ${n}ページ目`);
          el.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
        }
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, title]);

  return (
    <div
      className="img-wrap"
      tabIndex={0}
      role="region"
      aria-label={`${title}（スクロールできます）`}
    >
      {state === 'loading' && (
        <p className="meta-line" style={{ padding: 14 }}>
          原本を表示しています…
        </p>
      )}
      {state === 'error' && (
        <p className="meta-line" style={{ padding: 14 }}>
          原本を表示できませんでした。<a href={url}>ダウンロード</a>
          して確認してください。
        </p>
      )}
      <div ref={host} />
    </div>
  );
}
