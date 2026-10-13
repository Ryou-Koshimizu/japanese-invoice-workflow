import type { Case, DateStyle, Template } from './invoice-data';

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

export function formatDate(isoDate: string, style: DateStyle) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (style === 'slash')
    return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  if (style === 'reiwa') return `令和${y - 2018}年${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}
const money: Record<Template, (n: number) => string> = {
  classic: (n) => `¥${n.toLocaleString('ja-JP')}`,
  modern: (n) => `${n.toLocaleString('ja-JP')}円`,
  simple: (n) => `￥${n.toLocaleString('ja-JP')}-`,
};

const css = (fontCss: string, scan: boolean) => `
<link rel="stylesheet" href="${fontCss}">
<style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: ${scan ? '#e9e6df' : '#fff'} }
body { font-family: 'Noto Sans JP', sans-serif; color: #1d1d1f; font-size: 12.5px }
.page { width: 794px; min-height: 1123px; padding: 64px 68px; background: #fff; position: relative;
  ${scan ? 'transform: rotate(-1.3deg) translate(6px, 10px); filter: grayscale(1) blur(0.55px) contrast(0.82) brightness(1.04);' : ''} }
h1 { font-weight: 700; letter-spacing: .5em; text-align: center; font-size: 26px; margin: 0 0 28px }
.row { display: flex; justify-content: space-between; gap: 24px }
.to { font-size: 17px; border-bottom: 1px solid #333; padding-bottom: 4px; min-width: 300px }
.issuer { text-align: right; line-height: 1.7; position: relative }
.stamp { position: absolute; right: -40px; top: -34px; width: 58px; height: 58px; border: 2px solid #c8102e;
  border-radius: 50%; color: #c8102e; font-size: 10px; display: grid; place-items: center; opacity: .8; transform: rotate(-12deg) }
.meta { margin: 18px 0; line-height: 1.8 }
.total { font-size: 20px; font-weight: 700; border: 2px solid #333; padding: 10px 16px; display: inline-block; margin: 8px 0 18px }
table { width: 100%; border-collapse: collapse; margin: 10px 0 }
th, td { border: 1px solid #888; padding: 6px 8px }
th { background: #f0f0f0; font-weight: 600 }
td.n { text-align: right; white-space: nowrap }
.box { margin-left: auto; width: 360px }
.note { color: #555; font-size: 11px; margin-top: 18px; line-height: 1.7 }
.modern h1 { text-align: left; letter-spacing: .1em; font-size: 30px; color: #0b4f6c }
.modern th { background: #0b4f6c; color: #fff; border-color: #0b4f6c }
.modern td { border-left: none; border-right: none }
.modern .total { border: none; background: #eef6f9; color: #0b4f6c }
.simple table, .simple th, .simple td { border: none; border-bottom: 1px dotted #999 }
.noise { position: absolute; inset: 0; pointer-events: none; opacity: .18; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E") }
</style>`;

export function renderInvoice(c: Case, fontCss: string): string {
  const t = c.truth;
  const fmt = money[c.template];
  const date = (d: string | null) => (d ? formatDate(d, c.dateStyle) : '');
  const reduced = t.taxBreakdown.some((x) => x.rate === 8);
  const basisLabel = t.amountBasis === 'including' ? '（税込）' : '（税抜）';
  const lineRows = c.lines
    .map(
      (l) => `<tr><td>${esc(l.description)}</td><td class="n">${l.quantity}</td>
      <td class="n">${fmt(l.unitPrice)}</td><td class="n">${fmt(l.amount)}</td></tr>`,
    )
    .join('');
  const breakdown = t.taxBreakdown
    .map(
      (
        x,
      ) => `<tr><td>${x.rate}%対象${x.rate === 8 ? '（軽減税率）' : ''}${basisLabel}</td>
      <td class="n">${fmt(x.base)}</td><td>消費税</td><td class="n">${fmt(x.tax)}</td></tr>`,
    )
    .join('');
  const withholding = t.withholdingTax
    ? `<tr><td colspan="3">源泉徴収税額（所得税及び復興特別所得税）</td><td class="n">-${fmt(t.withholdingTax)}</td></tr>`
    : '';
  const issuer = `<div class="issuer">
      <div style="font-weight:700;font-size:15px">${esc(t.vendorName ?? '')}</div>
      <div>登録番号：${esc(t.registrationNumber ?? '')}</div>
      <div>〒100-0000 東京都架空区サンプル1-2-3</div>
      <div>TEL 03-0000-0000</div>
      ${c.template === 'classic' ? '<div class="stamp">印</div>' : ''}
    </div>`;
  const meta = `<div class="meta">
      請求書番号：${esc(t.invoiceNumber ?? '')}<br>
      請求日：${date(t.issueDate)}<br>
      お支払期限：${date(t.dueDate)}
    </div>`;

  const body =
    c.template === 'simple'
      ? `<h1>請 求 書</h1>
        <div class="row"><div><div class="to">${esc(t.recipientName ?? '')} 御中</div>${meta}</div>${issuer}</div>
        <p>下記のとおりご請求申し上げます。</p>
        <table><tr><th>内容</th><th>数量</th><th>単価</th><th>金額</th></tr>${lineRows}</table>
        <table class="box">${breakdown}${withholding}
          <tr><td colspan="3"><b>ご請求金額</b></td><td class="n"><b>${fmt(t.totalAmount ?? 0)}</b></td></tr></table>
        <div class="note">お振込先：架空銀行 本店 普通 0000000<br>振込手数料はご負担願います。</div>`
      : `<h1>請求書</h1>
        <div class="row"><div><div class="to">${esc(t.recipientName ?? '')} 御中</div>${meta}
          <div>ご請求金額</div><div class="total">${fmt(t.totalAmount ?? 0)}${c.template === 'classic' ? '（税込）' : ''}</div></div>${issuer}</div>
        <table><tr><th style="width:50%">品名</th><th>数量</th><th>単価</th><th>金額${basisLabel}</th></tr>${lineRows}</table>
        <table class="box">${breakdown}${withholding}</table>
        <div class="note">${reduced ? '「※」は軽減税率（8%）対象品目です。<br>' : ''}お振込先：架空銀行 本店 普通 0000000</div>`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">${css(fontCss, c.scanLike)}</head>
    <body><div class="page ${c.template}">${body}${c.scanLike ? '<div class="noise"></div>' : ''}</div></body></html>`;
}
