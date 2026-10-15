import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// Next.js injects inline bootstrap scripts, so script-src keeps 'unsafe-inline'
// (a nonce would make every page dynamic). Everything else is same-origin only:
// no third-party scripts, no framing, no plugins, no eval outside development.
// pdf.js may compile its image decoders to WebAssembly, hence 'wasm-unsafe-eval'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  // scripts/vercel-build.mjs runs the app as one Node server (see ADR 003).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  serverExternalPackages: [
    'pg',
    '@electric-sql/pglite',
    'pdfjs-dist',
    '@napi-rs/canvas',
  ],
  outputFileTracingIncludes: {
    '/**': [
      './db/schema.sql',
      './fixtures/**',
      './eval/cases.json',
      './eval/invoices/**',
      // pdf.js loads its worker and its DOMMatrix/Path2D polyfill at runtime,
      // which file tracing cannot see; without them serverless hosts cannot
      // open PDFs.
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/@napi-rs/**',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
          },
          // Ignored by browsers over plain http, so local runs are unaffected.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
};
export default config;
