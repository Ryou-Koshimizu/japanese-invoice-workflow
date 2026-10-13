import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/**': ['./db/schema.sql', './fixtures/**', './eval/invoices/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
export default config;
