import { createHash } from 'node:crypto';
import type { InvoiceFile } from '../core/invoice';
import { AppError } from './db';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 20;

/** Decide the type from the first bytes, never from the name or the header. */
export function sniff(bytes: Uint8Array): InvoiceFile['mediaType'] | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

async function loadPdf(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    getPage: (n: number) => doc.getPage(n),
    destroy: () => task.destroy(),
  };
}

/** Text layer of a PDF (empty for scans), capped for storage. */
export async function pdfText(
  bytes: Uint8Array,
  maxChars = 20_000,
): Promise<string> {
  const doc = await loadPdf(bytes);
  try {
    let text = '';
    for (
      let i = 1;
      i <= Math.min(doc.numPages, MAX_PAGES) && text.length < maxChars;
      i++
    ) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
    }
    return text.slice(0, maxChars);
  } finally {
    await doc.destroy();
  }
}

export async function inspectUpload(
  name: string,
  bytes: Uint8Array,
): Promise<InvoiceFile & { pages: number }> {
  if (!bytes.length) throw new AppError(400, 'ファイルが空です。');
  if (bytes.length > MAX_BYTES)
    throw new AppError(413, 'ファイルは10MBまでです。');
  const mediaType = sniff(bytes);
  if (!mediaType)
    throw new AppError(400, 'PDF・PNG・JPEGのみアップロードできます。');
  let pages = 1;
  if (mediaType === 'application/pdf') {
    try {
      const doc = await loadPdf(bytes);
      pages = doc.numPages;
      await doc.destroy();
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'pdf_load_failed',
          name: (e as Error)?.name,
          message: String((e as Error)?.message).slice(0, 200),
        }),
      );
      throw new AppError(
        400,
        'PDFを読み込めませんでした。暗号化や破損がないか確認してください。',
      );
    }
    if (pages > MAX_PAGES)
      throw new AppError(400, `PDFは${MAX_PAGES}ページまでです。`);
  }
  const safeName =
    name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'invoice';
  return {
    name: safeName,
    bytes,
    mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pages,
  };
}
