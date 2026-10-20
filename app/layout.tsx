import '@fontsource-variable/noto-sans-jp';
import '@fontsource/zen-maru-gothic/500.css';
import '@fontsource/zen-maru-gothic/700.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '請求書AIワークフロー',
  description:
    'AIで請求書を読み取り、インボイス制度の要件と計算を検証して、承認・仕訳CSV出力まで行う業務システム',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fbf4e9',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <div className="pebbles" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        {children}
      </body>
    </html>
  );
}
