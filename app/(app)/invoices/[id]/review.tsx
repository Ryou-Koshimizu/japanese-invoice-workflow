'use client';
import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Check,
  ExternalLink,
  FileText,
  History,
  ListChecks,
  Plus,
  ScanLine,
  Send,
  Stamp,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  fieldLabels,
  statusLabels,
  type FieldName,
  type InvoiceData,
  type Issue,
  type Role,
} from '../../../../src/core/invoice';
import { can } from '../../../../src/core/workflow';
import type { InvoiceRow } from '../../../../src/server/service';
import { auditLabel, jstDateTime, yen } from '../../../../src/ui/format';
import PdfViewer from '../../../../src/ui/pdf-viewer';

type Audit = {
  action: string;
  detail: Record<string, unknown>;
  at: string;
  actor: string | null;
};

const blank: InvoiceData = {
  vendorName: null,
  registrationNumber: null,
  invoiceNumber: null,
  issueDate: null,
  dueDate: null,
  recipientName: null,
  amountBasis: 'excluding',
  taxBreakdown: [{ rate: 10, base: 0, tax: 0 }],
  withholdingTax: 0,
  totalAmount: null,
  lineItems: [],
};

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? '処理に失敗しました。');
  return json;
}

const toInt = (v: string) =>
  v.trim() === '' ? 0 : Math.trunc(Number(v.replace(/[,\s¥￥円]/g, ''))) || 0;
const nullable = (v: string) => (v.trim() === '' ? null : v.trim());
const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, reduced() ? 0 : ms));

/** The rules grouped the way a reviewer thinks about them. */
const checkGroups: { label: string; codes: string[]; fields: string[] }[] = [
  {
    label: '登録番号',
    codes: ['REG_FORMAT', 'REG_CHECK_DIGIT'],
    fields: ['registrationNumber'],
  },
  {
    label: '記載事項',
    codes: ['QUALIFIED_ITEMS'],
    fields: ['vendorName', 'invoiceNumber', 'recipientName'],
  },
  { label: '税額', codes: [], fields: ['taxBreakdown'] },
  { label: '合計', codes: [], fields: ['totalAmount'] },
  { label: '明細', codes: [], fields: ['lineItems'] },
  { label: '源泉徴収', codes: [], fields: ['withholdingTax'] },
  { label: '日付', codes: [], fields: ['issueDate', 'dueDate'] },
  { label: '重複', codes: ['DUPLICATE'], fields: [] },
];
const groupOf = (i: Issue) =>
  checkGroups.find((g) => g.codes.includes(i.code)) ??
  checkGroups.find((g) => g.fields.includes(i.field)) ??
  checkGroups[1];

export default function Review({
  invoice,
  audit,
  me,
  accounts,
  demo,
}: {
  invoice: InvoiceRow;
  audit: Audit[];
  me: { userId: string; role: Role };
  accounts: string[];
  demo: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<InvoiceData>(invoice.data ?? blank);
  const [account, setAccount] = useState(invoice.account ?? '雑費');
  const [issues, setIssues] = useState<Issue[]>(invoice.issues);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState(invoice.warning_note ?? '');
  const [reason, setReason] = useState('');
  // Bumped on every re-validation so the checks and wobbles replay.
  const [round, setRound] = useState(0);
  const [stamping, setStamping] = useState(false);
  const checkPanel = useRef<HTMLElement>(null);

  const state = { status: invoice.status, submittedBy: invoice.submitted_by };
  const actor = { userId: me.userId, role: me.role };
  const editable = can('edit', actor, state).ok;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const byField = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of [...warnings, ...errors]) m.set(i.field, i);
    return m;
  }, [errors, warnings]);
  const ai = invoice.ai_data;

  const update = (patch: Partial<InvoiceData>) => {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
    setMessage('');
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const fieldClass = (f: FieldName) => {
    const i = byField.get(f);
    return `field${i ? (i.severity === 'error' ? ' has-error' : ' has-warning') : ''}`;
  };
  const changed = (f: FieldName) =>
    ai && JSON.stringify(ai[f]) !== JSON.stringify(data[f]) ? (
      <span className="changed">AIの値から修正</span>
    ) : null;
  const hint = (f: FieldName) => {
    const i = byField.get(f);
    return i ? (
      <span className="hint">
        {i.severity === 'error' ? (
          <CircleAlert className="icon" aria-hidden="true" />
        ) : (
          <TriangleAlert className="icon" aria-hidden="true" />
        )}
        {i.message}
      </span>
    ) : null;
  };
  const text = (
    f: 'vendorName' | 'registrationNumber' | 'invoiceNumber' | 'recipientName',
    wide = false,
  ) => (
    <div className={`${fieldClass(f)}${wide ? ' wide' : ''}`}>
      <label htmlFor={f}>
        {fieldLabels[f]} {changed(f)}
      </label>
      <input
        id={f}
        type="text"
        value={data[f] ?? ''}
        disabled={!editable}
        onChange={(e) => update({ [f]: nullable(e.target.value) })}
        aria-invalid={byField.get(f)?.severity === 'error' || undefined}
      />
      {hint(f)}
    </div>
  );
  const date = (f: 'issueDate' | 'dueDate') => (
    <div className={fieldClass(f)}>
      <label htmlFor={f}>
        {fieldLabels[f]} {changed(f)}
      </label>
      <input
        id={f}
        type="date"
        value={data[f] ?? ''}
        disabled={!editable}
        onChange={(e) => update({ [f]: nullable(e.target.value) })}
      />
      {hint(f)}
    </div>
  );

  const isImage = invoice.file_type !== 'application/pdf';
  const decide = can('approve', actor, state);
  const submit = can('submit', actor, state);
  const reading = busy === 'extract';
  const checks = checkGroups.map((g) => {
    const mine = issues.filter((i) => groupOf(i) === g);
    return {
      label: g.label,
      state: mine.some((i) => i.severity === 'error')
        ? ('error' as const)
        : mine.length
          ? ('warning' as const)
          : ('ok' as const),
    };
  });
  const stampLabel =
    invoice.status === 'approved'
      ? '承認'
      : invoice.status === 'exported'
        ? '出力済'
        : null;

  return (
    <>
      <div className={stamping ? 'thud' : undefined}>
        <div className="page-head">
          <div>
            <a href="/" className="back">
              <ArrowLeft className="icon" aria-hidden="true" />
              請求書一覧
            </a>
            <h1>{data.vendorName ?? invoice.file_name}</h1>
            <p className="sub">
              <span className={`status s-${invoice.status}`}>
                {statusLabels[invoice.status]}
              </span>{' '}
              {invoice.file_name} ・ 登録者 {invoice.uploader_name}
              {invoice.submitter_name && ` ・ 依頼 ${invoice.submitter_name}`}
              {invoice.approver_name && ` ・ 承認 ${invoice.approver_name}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {stampLabel && (
              <span
                className={`stamp${invoice.status === 'exported' ? ' done' : ''}`}
                aria-hidden="true"
              >
                {stampLabel}
              </span>
            )}
            <div className="num" style={{ textAlign: 'right' }}>
              <div className="meta-line">請求金額</div>
              <b className="round" style={{ fontSize: 26 }}>
                {yen(data.totalAmount)}
              </b>
            </div>
          </div>
        </div>

        <div className="review">
          <section
            className="card viewer rise"
            aria-label="原本"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            <div className="viewer-head">
              <span>
                <FileText className="icon" aria-hidden="true" />
                原本
              </span>
              <a
                href={`/api/invoices/${invoice.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="back"
              >
                別タブで開く
                <ExternalLink className="icon" aria-hidden="true" />
              </a>
            </div>
            <div className="viewer-body">
              {isImage ? (
                <div
                  className="img-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label={`請求書の原本 ${invoice.file_name}（スクロールできます）`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/invoices/${invoice.id}/file`}
                    alt={`請求書の原本 ${invoice.file_name}`}
                  />
                </div>
              ) : (
                <PdfViewer
                  url={`/api/invoices/${invoice.id}/file`}
                  title={`請求書の原本 ${invoice.file_name}`}
                />
              )}
              {(reading || invoice.status === 'reviewing') && (
                <div
                  key={`scan-${round}`}
                  className={`scan${reading ? ' loop' : ''}`}
                  aria-hidden="true"
                />
              )}
            </div>
          </section>

          <section
            ref={checkPanel}
            className="card pad panel check rise"
            aria-label="検証と次の操作"
            style={{ '--i': 0 } as React.CSSProperties}
          >
            {invoice.status === 'rejected' && invoice.reject_reason && (
              <div className="issue error">
                <CircleAlert className="icon" aria-hidden="true" />
                <span>
                  <b>差し戻し理由</b>
                  {invoice.reject_reason}
                </span>
              </div>
            )}
            {invoice.status === 'submitted' && invoice.warning_note && (
              <div className="notice">
                <span>
                  <b>警告を確認した理由（依頼者）：</b>
                  {invoice.warning_note}
                </span>
              </div>
            )}

            {invoice.status === 'uploaded' ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <h2>AIで読み取る</h2>
                <p className="sub" style={{ margin: 0 }}>
                  {demo
                    ? '公開デモでは、同梱のサンプル請求書に事前に用意した読み取り結果（正解データから作成）を使います。AIは呼び出しません。'
                    : '原本をAIに送り、取引先・金額・税額などを読み取ります。読み取り後に自動で検証します。'}
                </p>
                {invoice.extraction_meta?.error && (
                  <div className="alert">{invoice.extraction_meta.error}</div>
                )}
                <div className="actions">
                  <button
                    className="btn primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('extract', async () => {
                        await call(
                          `/api/invoices/${invoice.id}/extract`,
                          'POST',
                        );
                        await pause(500);
                        window.location.reload();
                      })
                    }
                  >
                    <ScanLine className="icon" aria-hidden="true" />
                    {reading ? '読み取り中…' : 'AIで読み取る'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="panel-title">
                  <h2>検証結果</h2>
                  {invoice.extraction_meta?.provider && (
                    <span className="meta-line">
                      読み取り：
                      {invoice.extraction_meta.provider === 'demo-fixture'
                        ? 'デモ用の事前データ（正解データから作成。AIの出力とは別）'
                        : `${invoice.extraction_meta.provider} ・ ${((invoice.extraction_meta.elapsedMs ?? 0) / 1000).toFixed(1)}秒 ・ 入力${invoice.extraction_meta.usage?.inputTokens ?? 0} / 出力${invoice.extraction_meta.usage?.outputTokens ?? 0}トークン`}
                    </span>
                  )}
                </div>
                <ul className="checks" aria-label="検証ルールごとの結果">
                  {checks.map((c, n) => (
                    <li
                      key={`${round}-${c.label}`}
                      className={c.state}
                      style={{ '--i': n } as React.CSSProperties}
                    >
                      <span className="mark" aria-hidden="true">
                        {c.state === 'ok' ? (
                          <Check className="icon" />
                        ) : c.state === 'error' ? (
                          <X className="icon" />
                        ) : (
                          <TriangleAlert className="icon" />
                        )}
                      </span>
                      {c.label}
                      <span className="sr-only">
                        {c.state === 'ok'
                          ? '：問題なし'
                          : c.state === 'error'
                            ? '：エラー'
                            : '：警告'}
                      </span>
                    </li>
                  ))}
                </ul>
                {issues.length ? (
                  <ul className="issues" aria-label="検証で見つかった問題">
                    {[...errors, ...warnings].map((i, n) => (
                      <li
                        key={`${round}-${n}`}
                        className={`issue ${i.severity}`}
                        style={{ '--i': n } as React.CSSProperties}
                      >
                        {i.severity === 'error' ? (
                          <CircleAlert className="icon" aria-hidden="true" />
                        ) : (
                          <TriangleAlert className="icon" aria-hidden="true" />
                        )}
                        <span>
                          <b>{i.severity === 'error' ? 'エラー' : '警告'}</b>
                          {i.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ok-banner" key={`ok-${round}`}>
                    <span className="tick" aria-hidden="true">
                      <Check className="icon" />
                    </span>
                    インボイス制度の記載事項と計算に問題は見つかりませんでした。
                  </div>
                )}

                {submit.ok && (
                  <div className="next">
                    <h2>
                      <Send className="icon" aria-hidden="true" />
                      承認依頼
                    </h2>
                    {errors.length > 0 ? (
                      <p className="meta-line" style={{ margin: 0 }}>
                        エラーが{errors.length}
                        件あるため承認依頼できません。原本と照らして下の内容を修正し、保存してください。
                      </p>
                    ) : (
                      <>
                        {warnings.length > 0 && (
                          <div className="field">
                            <label htmlFor="note">
                              警告を確認した理由（必須）
                            </label>
                            <textarea
                              id="note"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder="例：登録番号は公表サイトで照会し、原本どおりと確認済み"
                            />
                          </div>
                        )}
                        <div className="actions">
                          <button
                            className="btn primary"
                            disabled={
                              !!busy ||
                              dirty ||
                              (warnings.length > 0 && !note.trim())
                            }
                            onClick={() =>
                              run('submit', async () => {
                                await call(
                                  `/api/invoices/${invoice.id}/submit`,
                                  'POST',
                                  { note },
                                );
                                window.location.reload();
                              })
                            }
                          >
                            <Send className="icon" aria-hidden="true" />
                            {busy === 'submit' ? '依頼中…' : '承認を依頼する'}
                          </button>
                          {dirty && (
                            <span className="meta-line">
                              先に変更を保存してください。
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {invoice.status === 'submitted' && (
                  <div className="next">
                    <h2>
                      <Stamp className="icon" aria-hidden="true" />
                      承認
                    </h2>
                    {decide.ok ? (
                      <>
                        <div className="field">
                          <label htmlFor="reason">差し戻す場合の理由</label>
                          <textarea
                            id="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </div>
                        <div className="actions">
                          <button
                            className="btn primary"
                            disabled={!!busy}
                            onClick={() =>
                              run('approve', async () => {
                                await call(
                                  `/api/invoices/${invoice.id}/decision`,
                                  'POST',
                                  { decision: 'approve' },
                                );
                                setStamping(true);
                                await pause(1100);
                                window.location.reload();
                              })
                            }
                          >
                            <Stamp className="icon" aria-hidden="true" />
                            承認する
                          </button>
                          <button
                            className="btn danger"
                            disabled={!!busy || !reason.trim()}
                            onClick={() =>
                              run('reject', async () => {
                                await call(
                                  `/api/invoices/${invoice.id}/decision`,
                                  'POST',
                                  { decision: 'reject', reason },
                                );
                                window.location.reload();
                              })
                            }
                          >
                            差し戻す
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="meta-line" style={{ margin: 0 }}>
                        {decide.reason}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {invoice.status !== 'uploaded' && (
            <section
              className="card pad form rise"
              aria-label="読み取り結果"
              style={{ '--i': 2 } as React.CSSProperties}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run('save', async () => {
                    const r = await call(`/api/invoices/${invoice.id}`, 'PUT', {
                      data,
                      account,
                    });
                    setIssues(r.issues);
                    setDirty(false);
                    setRound((n) => n + 1);
                    setMessage('保存して再検証しました。');
                    checkPanel.current?.scrollIntoView({
                      behavior: reduced() ? 'auto' : 'smooth',
                      block: 'start',
                    });
                    router.refresh();
                  });
                }}
              >
                <div className="section">
                  <h2>請求書の内容</h2>
                  <div className="form-grid">
                    {text('vendorName', true)}
                    {text('registrationNumber')}
                    {text('invoiceNumber')}
                    {date('issueDate')}
                    {date('dueDate')}
                    {text('recipientName', true)}
                  </div>
                </div>

                <div className="section">
                  <div className={fieldClass('taxBreakdown')}>
                    <h2>税率ごとの金額 {changed('taxBreakdown')}</h2>
                    <div
                      className="field"
                      style={{ maxWidth: 260, marginBottom: 8 }}
                    >
                      <label htmlFor="basis">金額の表示</label>
                      <select
                        id="basis"
                        value={data.amountBasis}
                        disabled={!editable}
                        onChange={(e) =>
                          update({
                            amountBasis: e.target
                              .value as InvoiceData['amountBasis'],
                          })
                        }
                      >
                        <option value="excluding">税抜で記載</option>
                        <option value="including">税込で記載</option>
                      </select>
                    </div>
                    <table className="mini">
                      <thead>
                        <tr>
                          <th>税率</th>
                          <th>対象の金額</th>
                          <th>消費税額</th>
                          <th aria-label="削除" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.taxBreakdown.map((t, n) => (
                          <tr key={n}>
                            <td style={{ width: 120 }}>
                              <select
                                aria-label={`税率 ${n + 1}`}
                                value={t.rate}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    taxBreakdown: data.taxBreakdown.map(
                                      (x, k) =>
                                        k === n
                                          ? {
                                              ...x,
                                              rate: Number(e.target.value) as
                                                10 | 8,
                                            }
                                          : x,
                                    ),
                                  })
                                }
                              >
                                <option value={10}>10%</option>
                                <option value={8}>8%（軽減）</option>
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`${t.rate}%の対象の金額`}
                                className="num"
                                type="text"
                                inputMode="numeric"
                                value={t.base}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    taxBreakdown: data.taxBreakdown.map(
                                      (x, k) =>
                                        k === n
                                          ? {
                                              ...x,
                                              base: toInt(e.target.value),
                                            }
                                          : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`${t.rate}%の消費税額`}
                                className="num"
                                type="text"
                                inputMode="numeric"
                                value={t.tax}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    taxBreakdown: data.taxBreakdown.map(
                                      (x, k) =>
                                        k === n
                                          ? { ...x, tax: toInt(e.target.value) }
                                          : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              {editable && data.taxBreakdown.length > 1 && (
                                <button
                                  type="button"
                                  className="del"
                                  aria-label="この税率の行を削除"
                                  onClick={() =>
                                    update({
                                      taxBreakdown: data.taxBreakdown.filter(
                                        (_, k) => k !== n,
                                      ),
                                    })
                                  }
                                >
                                  <X className="icon" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && data.taxBreakdown.length < 2 && (
                      <button
                        type="button"
                        className="btn small"
                        style={{ marginTop: 4 }}
                        onClick={() =>
                          update({
                            taxBreakdown: [
                              ...data.taxBreakdown,
                              {
                                rate: data.taxBreakdown[0]?.rate === 8 ? 10 : 8,
                                base: 0,
                                tax: 0,
                              },
                            ],
                          })
                        }
                      >
                        <Plus className="icon" aria-hidden="true" />
                        税率を追加
                      </button>
                    )}
                    {hint('taxBreakdown')}
                  </div>
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className={fieldClass('withholdingTax')}>
                      <label htmlFor="wh">
                        {fieldLabels.withholdingTax} {changed('withholdingTax')}
                      </label>
                      <input
                        id="wh"
                        className="num"
                        type="text"
                        inputMode="numeric"
                        value={data.withholdingTax}
                        disabled={!editable}
                        onChange={(e) =>
                          update({ withholdingTax: toInt(e.target.value) })
                        }
                      />
                      {hint('withholdingTax')}
                    </div>
                    <div className={fieldClass('totalAmount')}>
                      <label htmlFor="total">
                        {fieldLabels.totalAmount} {changed('totalAmount')}
                      </label>
                      <input
                        id="total"
                        className="num"
                        type="text"
                        inputMode="numeric"
                        value={data.totalAmount ?? ''}
                        disabled={!editable}
                        onChange={(e) =>
                          update({
                            totalAmount:
                              e.target.value.trim() === ''
                                ? null
                                : toInt(e.target.value),
                          })
                        }
                      />
                      {hint('totalAmount')}
                    </div>
                  </div>
                </div>

                <div className="section">
                  <div className={fieldClass('lineItems')}>
                    <h2>明細 {changed('lineItems')}</h2>
                    <table className="mini">
                      <thead>
                        <tr>
                          <th>内容</th>
                          <th style={{ width: 130 }}>金額</th>
                          <th style={{ width: 110 }}>税率</th>
                          <th aria-label="削除" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.lineItems.map((l, n) => (
                          <tr key={n}>
                            <td>
                              <input
                                aria-label={`明細${n + 1}の内容`}
                                type="text"
                                value={l.description}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    lineItems: data.lineItems.map((x, k) =>
                                      k === n
                                        ? { ...x, description: e.target.value }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`明細${n + 1}の金額`}
                                className="num"
                                type="text"
                                inputMode="numeric"
                                value={l.amount}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    lineItems: data.lineItems.map((x, k) =>
                                      k === n
                                        ? {
                                            ...x,
                                            amount: toInt(e.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`明細${n + 1}の税率`}
                                value={l.taxRate}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    lineItems: data.lineItems.map((x, k) =>
                                      k === n
                                        ? {
                                            ...x,
                                            taxRate: Number(e.target.value) as
                                              10 | 8,
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              >
                                <option value={10}>10%</option>
                                <option value={8}>8%</option>
                              </select>
                            </td>
                            <td>
                              {editable && (
                                <button
                                  type="button"
                                  className="del"
                                  aria-label={`明細${n + 1}を削除`}
                                  onClick={() =>
                                    update({
                                      lineItems: data.lineItems.filter(
                                        (_, k) => k !== n,
                                      ),
                                    })
                                  }
                                >
                                  <X className="icon" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && (
                      <button
                        type="button"
                        className="btn small"
                        style={{ marginTop: 4 }}
                        onClick={() =>
                          update({
                            lineItems: [
                              ...data.lineItems,
                              { description: '', amount: 0, taxRate: 10 },
                            ],
                          })
                        }
                      >
                        <Plus className="icon" aria-hidden="true" />
                        明細を追加
                      </button>
                    )}
                    {hint('lineItems')}
                  </div>
                </div>

                <div className="section">
                  <div className="field" style={{ maxWidth: 320 }}>
                    <label htmlFor="account">勘定科目</label>
                    <select
                      id="account"
                      value={account}
                      disabled={!editable}
                      onChange={(e) => {
                        setAccount(e.target.value);
                        setDirty(true);
                      }}
                    >
                      {accounts.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                    {invoice.extraction_meta?.accountSource && (
                      <span className="meta-line">
                        候補の根拠：
                        {{
                          vendor: '同じ取引先で過去に承認された科目',
                          keyword: '明細の内容',
                          ai: 'AIの推定',
                          default: '該当なし（既定）',
                        }[invoice.extraction_meta.accountSource] ?? '—'}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className={
                    editable ? `save-bar${dirty ? ' floating' : ''}` : 'section'
                  }
                  style={{ display: 'grid', gap: 10 }}
                >
                  {error && (
                    <div className="alert" role="alert">
                      {error}
                    </div>
                  )}
                  {message && (
                    <div className="alert success" role="status">
                      {message}
                    </div>
                  )}
                  {editable && (
                    <div className="actions">
                      <button
                        type="submit"
                        className={dirty ? 'btn primary' : 'btn'}
                        disabled={!!busy || !dirty}
                      >
                        <ListChecks className="icon" aria-hidden="true" />
                        {busy === 'save'
                          ? '保存中…'
                          : dirty
                            ? '保存して再検証'
                            : '保存済み'}
                      </button>
                      {can('extract', actor, state).ok && (
                        <button
                          type="button"
                          className="btn"
                          disabled={!!busy}
                          onClick={() =>
                            run('extract', async () => {
                              if (
                                !confirm(
                                  'AIで読み取り直します。手で修正した内容は上書きされます。',
                                )
                              )
                                return;
                              await call(
                                `/api/invoices/${invoice.id}/extract`,
                                'POST',
                              );
                              router.refresh();
                              window.location.reload();
                            })
                          }
                        >
                          <ScanLine className="icon" aria-hidden="true" />
                          AIで読み取り直す
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </form>
            </section>
          )}

          <section
            className="card pad log rise"
            aria-labelledby="history-heading"
            style={{ '--i': 3 } as React.CSSProperties}
          >
            <h2 id="history-heading">
              <History
                className="icon"
                aria-hidden="true"
                style={{ verticalAlign: '-3px', marginRight: 6 }}
              />
              履歴
            </h2>
            <ol className="timeline">
              {audit.map((a, n) => (
                <li key={n} style={{ '--i': n } as React.CSSProperties}>
                  <time dateTime={a.at}>{jstDateTime(a.at)}</time>
                  <span>
                    <b>{auditLabel(a.action)}</b> {a.actor ?? 'システム'}
                    {a.action === 'edit' && (
                      <span className="meta-line">
                        {' '}
                        （
                        {Object.keys(a.detail)
                          .map((k) => fieldLabels[k as FieldName] ?? k)
                          .join('、')}
                        ）
                      </span>
                    )}
                    {typeof a.detail.reason === 'string' && (
                      <span className="meta-line">：{a.detail.reason}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {stamping && (
        <div className="stamp-stage" role="status">
          <span className="ink" aria-hidden="true" />
          <span className="stamp">承認</span>
          <span className="sr-only">承認しました</span>
        </div>
      )}
    </>
  );
}
