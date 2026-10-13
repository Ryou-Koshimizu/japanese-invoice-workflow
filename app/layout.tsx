import '@fontsource-variable/noto-sans-jp';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '請求書AIワークフロー',
  description:
    'AIで請求書を読み取り、インボイス制度の要件と計算を検証して、承認・仕訳CSV出力まで行う業務システム',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
