// Deterministic fictional invoice data for the eval set and the public demo.
// Company names are invented. Registration numbers are random digits with a
// valid corporate check digit; they are not looked up and must not be used to
// identify real businesses.
import type { InvoiceData } from '../src/core/invoice';
import { corporateCheckDigit, expectedWithholding } from '../src/core/rules';

export type Group = 'standard' | 'reduced' | 'withholding' | 'hard' | 'error';
export type Template = 'classic' | 'modern' | 'simple';
export type DateStyle = 'kanji' | 'slash' | 'reiwa';
export type Case = {
  id: string;
  group: Group;
  template: Template;
  dateStyle: DateStyle;
  scanLike: boolean;
  truth: InvoiceData;
  /** Validation codes this invoice must raise (errors seeded on purpose). */
  expectedIssues: string[];
  note?: string;
  lines: Line[];
};
export type Line = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: 10 | 8;
};

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261014);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function corporateNumber(): string {
  const base = Array.from({ length: 12 }, () => int(0, 9)).join('');
  return `T${corporateCheckDigit(base)}${base}`;
}
function individualNumber(): string {
  // Sole proprietors get numbers that need not satisfy the corporate check digit.
  let n: string;
  do {
    n = Array.from({ length: 13 }, (_, i) =>
      i === 0 ? int(1, 9) : int(0, 9),
    ).join('');
  } while (corporateCheckDigit(n.slice(1)) === Number(n[0]));
  return `T${n}`;
}

const companies = [
  '株式会社みなと印刷',
  '合同会社ソラ企画',
  '有限会社やまびこ商会',
  '株式会社アオバ通信',
  '株式会社ひかりデザインラボ',
  '北斗フードサービス株式会社',
  '株式会社クレア文具',
  '株式会社ツバメ物流',
  '株式会社ミライ広告',
  'こもれび青果株式会社',
  '株式会社ナギサ不動産管理',
  '株式会社ルミナス研修',
];
const individuals = [
  'デザイン事務所 佐々木葵',
  '翻訳 田中結衣',
  '写真 山本蓮',
  'ライター 小林湊',
  '開発 中村陽向',
  '動画編集 伊藤凛',
];
const recipient = '株式会社サンプル商事';

const catalog10: [string, number, number][] = [
  ['光回線利用料（10月分）', 6380, 6380],
  ['クラウドサーバー利用料', 12000, 48000],
  ['チラシ印刷 A4両面 1,000部', 18000, 42000],
  ['Web広告運用代行', 80000, 150000],
  ['ロゴデザイン制作', 60000, 120000],
  ['コピー用紙 A4 5箱', 2980, 3480],
  ['トナーカートリッジ', 7800, 12800],
  ['配送料', 900, 1600],
  ['会議室利用料', 5000, 15000],
  ['オフィス清掃作業費', 15000, 30000],
  ['複合機保守メンテナンス', 8000, 12000],
  ['決済手数料', 1200, 4800],
  ['ビジネスマナー研修', 50000, 120000],
  ['業務用書籍', 1980, 4620],
  ['SNS運用サポート', 40000, 90000],
  ['動画制作費', 100000, 300000],
];
const catalog8: [string, number, number][] = [
  ['※ お弁当（会議用）', 860, 1280],
  ['※ ペットボトル飲料 24本', 2400, 3200],
  ['※ 国産野菜セット', 3800, 6200],
  ['※ 焼き菓子詰め合わせ', 2160, 4320],
  ['※ コーヒー豆 1kg', 3200, 5400],
  ['※ 新米 5kg', 2980, 4280],
];
const fees: [string, number, number][] = [
  ['デザイン料', 50000, 300000],
  ['翻訳料', 30000, 200000],
  ['撮影料', 60000, 250000],
  ['原稿料', 20000, 150000],
  ['システム開発報酬', 300000, 900000],
];

function lines(
  count: number,
  catalog: [string, number, number][],
  rate: 10 | 8,
): Line[] {
  const chosen = new Set<number>();
  while (chosen.size < Math.min(count, catalog.length))
    chosen.add(int(0, catalog.length - 1));
  return [...chosen].map((i) => {
    const [description, lo, hi] = catalog[i];
    const unitPrice = Math.round(int(lo, hi) / 10) * 10;
    const quantity = unitPrice > 30000 ? 1 : int(1, 5);
    return {
      description,
      quantity,
      unitPrice,
      amount: unitPrice * quantity,
      taxRate: rate,
    };
  });
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function dates() {
  const m = int(8, 9);
  const d = m === 9 ? int(1, 30) : int(1, 31);
  const issue = iso(2026, m, d);
  const due = m === 8 ? iso(2026, 9, 30) : iso(2026, 10, 31);
  return { issue, due };
}

type Rounding = 'floor' | 'round' | 'ceil';
const roundBy = (x: number, r: Rounding) => Math[r](x);

function build(
  id: string,
  group: Group,
  opts: {
    vendor: string;
    reg: string;
    lines: Line[];
    basis?: 'excluding' | 'including';
    withholding?: boolean;
    rounding?: Rounding;
  },
): { truth: InvoiceData; lines: Line[] } {
  const basis = opts.basis ?? 'excluding';
  const rounding = opts.rounding ?? 'floor';
  const { issue, due } = dates();
  const rates = ([10, 8] as const).filter((r) =>
    opts.lines.some((l) => l.taxRate === r),
  );
  const taxBreakdown = rates.map((rate) => {
    const base = opts.lines
      .filter((l) => l.taxRate === rate)
      .reduce((s, l) => s + l.amount, 0);
    const exact =
      basis === 'excluding'
        ? (base * rate) / 100
        : (base * rate) / (100 + rate);
    return { rate, base, tax: roundBy(exact, rounding) };
  });
  const excl = taxBreakdown.reduce(
    (s, t) => s + t.base - (basis === 'including' ? t.tax : 0),
    0,
  );
  const withholdingTax = opts.withholding ? expectedWithholding(excl) : 0;
  const gross = taxBreakdown.reduce(
    (s, t) => s + t.base + (basis === 'excluding' ? t.tax : 0),
    0,
  );
  return {
    lines: opts.lines,
    truth: {
      vendorName: opts.vendor,
      registrationNumber: opts.reg,
      invoiceNumber: `INV-${issue.slice(0, 7).replace('-', '')}-${String(int(1, 999)).padStart(3, '0')}`,
      issueDate: issue,
      dueDate: due,
      recipientName: recipient,
      amountBasis: basis,
      taxBreakdown,
      withholdingTax,
      totalAmount: gross - withholdingTax,
      lineItems: opts.lines.map((l) => ({
        description: l.description,
        amount: l.amount,
        taxRate: l.taxRate,
      })),
    },
  };
}

export function buildCases(): Case[] {
  const cases: Case[] = [];
  let n = 0;
  const next = () => `inv-${String(++n).padStart(2, '0')}`;
  const templates: Template[] = ['classic', 'modern', 'simple'];
  const dateStyles: DateStyle[] = ['kanji', 'slash', 'reiwa'];
  const add = (
    group: Group,
    built: { truth: InvoiceData; lines: Line[] },
    extra: Partial<Case> = {},
  ) => {
    const id = extra.id ?? next();
    cases.push({
      id,
      group,
      template: extra.template ?? templates[cases.length % 2],
      dateStyle: extra.dateStyle ?? dateStyles[cases.length % 3],
      scanLike: extra.scanLike ?? false,
      expectedIssues: extra.expectedIssues ?? [],
      note: extra.note,
      truth: built.truth,
      lines: built.lines,
    });
  };

  // Standard: 10% only. Three print tax-inclusive amounts, two round differently.
  for (let i = 0; i < 12; i++)
    add(
      'standard',
      build('', 'standard', {
        vendor: companies[i % companies.length],
        reg: corporateNumber(),
        lines: lines(int(1, 4), catalog10, 10),
        basis: i % 4 === 3 ? 'including' : 'excluding',
        rounding: i === 5 ? 'round' : i === 9 ? 'ceil' : 'floor',
      }),
    );

  // Mixed reduced (8%) and standard (10%) rates.
  for (let i = 0; i < 10; i++)
    add(
      'reduced',
      build('', 'reduced', {
        vendor: pick([
          '北斗フードサービス株式会社',
          'こもれび青果株式会社',
          '株式会社クレア文具',
        ]),
        reg: corporateNumber(),
        lines: [
          ...lines(int(1, 3), catalog8, 8),
          ...lines(int(1, 2), catalog10, 10),
        ],
        basis: i % 5 === 4 ? 'including' : 'excluding',
      }),
    );

  // Fees from individuals with withholding tax. One crosses the 1,000,000 yen bracket.
  for (let i = 0; i < 6; i++) {
    const fee = fees[i % fees.length];
    const amount =
      i === 5 ? 1_200_000 : Math.round(int(fee[1], fee[2]) / 1000) * 1000;
    add(
      'withholding',
      build('', 'withholding', {
        vendor: individuals[i],
        reg: individualNumber(),
        lines: [
          {
            description: fee[0],
            quantity: 1,
            unitPrice: amount,
            amount,
            taxRate: 10,
          },
        ],
        withholding: true,
      }),
      { template: 'simple' },
    );
  }

  // Hard to read: scan-like PNG only (tilt, blur, noise, low resolution).
  for (let i = 0; i < 6; i++)
    add(
      'hard',
      build('', 'hard', {
        vendor: companies[(i * 5) % companies.length],
        reg: corporateNumber(),
        lines:
          i % 2
            ? [...lines(2, catalog8, 8), ...lines(1, catalog10, 10)]
            : lines(int(2, 4), catalog10, 10),
      }),
      { scanLike: true, template: templates[i % 3] },
    );

  // Seeded mistakes. Truth is what is printed; expectedIssues is what must be caught.
  const errs: [
    string,
    string[],
    (b: { truth: InvoiceData; lines: Line[] }) => void,
  ][] = [
    [
      '税額を100円多く記載',
      ['TAX_CALC', 'TOTAL_MISMATCH'],
      (b) => {
        b.truth.taxBreakdown[0].tax += 100;
      },
    ],
    [
      '請求金額が内訳の合計と1,000円ずれている',
      ['TOTAL_MISMATCH'],
      (b) => {
        b.truth.totalAmount! += 1000;
      },
    ],
    [
      '登録番号が12桁',
      ['REG_FORMAT'],
      (b) => {
        b.truth.registrationNumber = b.truth.registrationNumber!.slice(0, 13);
      },
    ],
    [
      '軽減税率8%の対価に10%で税額を計算',
      ['TAX_CALC', 'TOTAL_MISMATCH'],
      (b) => {
        const t = b.truth.taxBreakdown.find((x) => x.rate === 8)!;
        const delta = Math.floor(t.base * 0.1) - t.tax;
        t.tax += delta;
        b.truth.totalAmount! += delta;
        // printed total is consistent with the wrong tax; only TAX_CALC must fire
      },
    ],
    [
      '源泉徴収を10%で計算',
      ['WITHHOLDING'],
      (b) => {
        const base = b.truth.taxBreakdown[0].base;
        const wrong = Math.floor(base * 0.1);
        b.truth.totalAmount! += b.truth.withholdingTax - wrong;
        b.truth.withholdingTax = wrong;
      },
    ],
    [
      '支払期日が請求日より前',
      ['DUE_BEFORE_ISSUE'],
      (b) => {
        b.truth.dueDate = '2026-07-31';
      },
    ],
  ];
  errs.forEach(([note, codes, mutate], i) => {
    const b =
      i === 3
        ? build('', 'error', {
            vendor: 'こもれび青果株式会社',
            reg: corporateNumber(),
            lines: [...lines(2, catalog8, 8), ...lines(1, catalog10, 10)],
          })
        : i === 4
          ? build('', 'error', {
              vendor: individuals[(i + 1) % individuals.length],
              reg: individualNumber(),
              lines: [
                {
                  description: '原稿料',
                  quantity: 1,
                  unitPrice: 80000,
                  amount: 80000,
                  taxRate: 10,
                },
              ],
              withholding: true,
            })
          : build('', 'error', {
              vendor: companies[(i * 7 + 3) % companies.length],
              reg: corporateNumber(),
              lines: lines(2, catalog10, 10),
            });
    mutate(b);
    const expected = i === 3 ? ['TAX_CALC'] : codes;
    add('error', b, {
      expectedIssues: expected,
      note,
      template: i === 4 ? 'simple' : templates[i % 2],
    });
  });

  return cases;
}
