export const yen = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `¥${n.toLocaleString('ja-JP')}`;

export function jstDateTime(iso: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const auditLabel = (action: string) =>
  ({
    upload: 'アップロード',
    edit: '内容を修正',
    account: '勘定科目を変更',
    export: 'CSVを出力',
    role: '役割を変更',
    billing: 'プランを変更',
    'status:reviewing': 'AIで読み取り',
    'status:submitted': '承認依頼',
    'status:approved': '承認',
    'status:rejected': '差し戻し',
    'status:exported': '出力済みに変更',
  })[action] ?? action;
