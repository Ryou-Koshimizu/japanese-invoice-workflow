import type { InvoiceData } from './invoice';

export const accounts = [
  '仕入高',
  '外注費',
  '支払報酬',
  '通信費',
  '消耗品費',
  '広告宣伝費',
  '支払手数料',
  '地代家賃',
  '水道光熱費',
  '旅費交通費',
  '会議費',
  '新聞図書費',
  '研修費',
  '修繕費',
  '雑費',
] as const;
export type Account = (typeof accounts)[number];

const keywords: [Account, RegExp][] = [
  ['通信費', /回線|通信|インターネット|サーバー|クラウド|ドメイン|携帯/],
  ['広告宣伝費', /広告|宣伝|掲載|チラシ|販促|SNS運用/],
  ['外注費', /制作|開発|デザイン|業務委託|運用代行|作業費/],
  ['消耗品費', /文具|用品|備品|トナー|コピー用紙|消耗品/],
  ['支払手数料', /手数料|決済|振込/],
  ['地代家賃', /家賃|賃料|オフィス利用|駐車場/],
  ['水道光熱費', /電気|ガス|水道/],
  ['旅費交通費', /交通|出張|宿泊|タクシー/],
  ['会議費', /会議|ケータリング|弁当|飲料/],
  ['新聞図書費', /書籍|図書|新聞|雑誌/],
  ['研修費', /研修|セミナー|講座/],
  ['修繕費', /修理|修繕|メンテナンス/],
  ['仕入高', /食品|仕入|商品|米|野菜|飲料品/],
];

/**
 * Suggest an account title. A confirmed choice for the same vendor wins, then
 * keyword rules, then the model's hint when it names a known account.
 * The person reviewing always makes the final decision.
 */
export function suggestAccount(
  d: InvoiceData,
  opts: { vendorAccount?: string | null; aiHint?: string | null } = {},
): { account: Account; source: 'vendor' | 'keyword' | 'ai' | 'default' } {
  if (
    opts.vendorAccount &&
    (accounts as readonly string[]).includes(opts.vendorAccount)
  )
    return { account: opts.vendorAccount as Account, source: 'vendor' };
  if (d.withholdingTax > 0) return { account: '支払報酬', source: 'keyword' };
  const scores = new Map<Account, number>();
  for (const [account, re] of keywords) {
    const hits = d.lineItems.filter((l) => re.test(l.description));
    if (hits.length)
      scores.set(
        account,
        hits.reduce((s, l) => s + Math.abs(l.amount), 0),
      );
  }
  if (scores.size)
    return {
      account: [...scores].sort((a, b) => b[1] - a[1])[0][0],
      source: 'keyword',
    };
  if (opts.aiHint && (accounts as readonly string[]).includes(opts.aiHint))
    return { account: opts.aiHint as Account, source: 'ai' };
  return { account: '雑費', source: 'default' };
}
