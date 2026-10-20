import type { Role, Status } from './invoice';

export type Action =
  'extract' | 'edit' | 'submit' | 'approve' | 'reject' | 'export';

/**
 * Upstream AI calls per invoice. One read makes two calls (three when they
 * disagree or one fails), so this allows three reads. Bounds what one upload
 * can cost on the operator's AI account; the database CHECK on
 * extraction_count enforces it.
 */
export const MAX_EXTRACTIONS = 9;

export type Actor = { userId: string; role: Role };
export type InvoiceState = { status: Status; submittedBy: string | null };

/**
 * The same rules the database trigger enforces, used for clear messages and
 * for deciding which buttons to show. The trigger remains the authority.
 */
export function can(
  action: Action,
  actor: Actor,
  inv: InvoiceState,
): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  switch (action) {
    case 'extract':
      return ['uploaded', 'reviewing', 'rejected'].includes(inv.status)
        ? { ok: true }
        : no('この状態では再抽出できません。');
    case 'edit':
      return ['reviewing', 'rejected'].includes(inv.status)
        ? { ok: true }
        : no('確認中または差し戻しの請求書だけ修正できます。');
    case 'submit':
      return ['reviewing', 'rejected'].includes(inv.status)
        ? { ok: true }
        : no('確認中または差し戻しの請求書だけ承認依頼できます。');
    case 'approve':
    case 'reject':
      if (inv.status !== 'submitted') return no('承認待ちではありません。');
      if (actor.role === 'member') return no('承認者または管理者の操作です。');
      if (inv.submittedBy === actor.userId)
        return no('自分が承認依頼した請求書は判断できません。');
      return { ok: true };
    case 'export':
      if (inv.status !== 'approved') return no('承認済みではありません。');
      if (actor.role !== 'admin') return no('管理者の操作です。');
      return { ok: true };
  }
}
