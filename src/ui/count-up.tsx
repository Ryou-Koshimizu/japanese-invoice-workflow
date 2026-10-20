'use client';
import { useEffect, useRef } from 'react';

/**
 * A number that counts up from zero when it first appears. The final value is
 * rendered on the server, so the page reads correctly without JavaScript and
 * with reduced motion; the animation only rewrites the text in between.
 */
export default function CountUp({
  value,
  format = 'int',
  duration = 1100,
}: {
  value: number;
  format?: 'int' | 'yen';
  duration?: number;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const text = (n: number) =>
    format === 'yen'
      ? `¥${Math.round(n).toLocaleString('ja-JP')}`
      : Math.round(n).toLocaleString('ja-JP');

  useEffect(() => {
    const node = el.current;
    if (!node || !value) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const start = performance.now() + 150;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 4);
      node.textContent = text(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    node.textContent = text(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      node.textContent = text(value);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, format, duration]);

  return (
    <span ref={el} className="num">
      {text(value)}
    </span>
  );
}
