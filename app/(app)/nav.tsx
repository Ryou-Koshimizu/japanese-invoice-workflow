'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CloudUpload,
  FileSpreadsheet,
  Inbox,
  Menu,
  ScrollText,
  UsersRound,
  X,
} from 'lucide-react';
import type { Role } from '../../src/core/invoice';

/**
 * The header's menu: inline on wide screens, a clay sheet behind a round
 * button on narrow ones. One set of links serves both.
 */
export default function HeaderMenu({
  role,
  todo,
  children,
}: {
  role: Role;
  todo: number;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.topbar')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);
  useEffect(() => {
    // The header is the closest ancestor with data-open.
    document
      .querySelector('.topbar')
      ?.setAttribute('data-open', open ? 'true' : 'false');
  }, [open]);

  const items = [
    { href: '/', label: '請求書一覧', count: todo, Icon: Inbox },
    { href: '/upload', label: 'アップロード', Icon: CloudUpload },
    ...(role === 'admin'
      ? [
          { href: '/export', label: '仕訳CSV出力', Icon: FileSpreadsheet },
          { href: '/audit', label: '監査ログ', Icon: ScrollText },
        ]
      : []),
    {
      href: '/settings',
      label: role === 'admin' ? 'メンバーとプラン' : 'プランと利用状況',
      Icon: UsersRound,
    },
  ];
  const active = (href: string) =>
    href === '/'
      ? path === '/' || path.startsWith('/invoices')
      : path.startsWith(href);
  return (
    <>
      <div className="menu-panel" id="menu-panel">
        <nav className="main-nav" aria-label="メニュー">
          {items.map(({ href, label, count, Icon }) => (
            <a
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon className="icon" aria-hidden="true" />
              <span>{label}</span>
              {!!count && (
                <span
                  className="count"
                  aria-label={`対応が必要な請求書 ${count}件`}
                >
                  {count}
                </span>
              )}
            </a>
          ))}
        </nav>
        {children}
      </div>
      <button
        type="button"
        className="icon-btn menu-toggle"
        aria-expanded={open}
        aria-controls="menu-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <X className="icon" aria-hidden="true" />
        ) : (
          <Menu className="icon" aria-hidden="true" />
        )}
        <span className="sr-only">
          {open ? 'メニューを閉じる' : 'メニューを開く'}
        </span>
      </button>
    </>
  );
}
