'use client';
import { usePathname } from 'next/navigation';
import type { Role } from '../../src/core/invoice';

export default function Nav({ role, todo }: { role: Role; todo: number }) {
  const path = usePathname();
  const items = [
    { href: '/', label: '請求書一覧', count: todo },
    { href: '/upload', label: 'アップロード' },
    ...(role === 'admin'
      ? [
          { href: '/export', label: '仕訳CSV出力' },
          { href: '/audit', label: '監査ログ' },
        ]
      : []),
    {
      href: '/settings',
      label: role === 'admin' ? 'メンバーとプラン' : 'プランと利用状況',
    },
  ];
  const active = (href: string) =>
    href === '/'
      ? path === '/' || path.startsWith('/invoices')
      : path.startsWith(href);
  return (
    <nav aria-label="メニュー">
      {items.map((i) => (
        <a
          key={i.href}
          href={i.href}
          aria-current={active(i.href) ? 'page' : undefined}
        >
          {i.label}
          {!!i.count && (
            <span
              className="count"
              aria-label={`対応が必要な請求書 ${i.count}件`}
            >
              {i.count}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
