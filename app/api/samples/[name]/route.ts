import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Ctx = { params: Promise<{ name: string }> };
const types: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};

/** Fictional sample invoices from the eval set, for trying the upload flow. */
export async function GET(_request: Request, { params }: Ctx) {
  const { name } = await params;
  const m = /^inv-\d{2}\.(pdf|png|jpg)$/.exec(name);
  if (!m) return new Response('Not found', { status: 404 });
  try {
    const bytes = await readFile(join(process.cwd(), 'eval/invoices', name));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': types[m[1]],
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
