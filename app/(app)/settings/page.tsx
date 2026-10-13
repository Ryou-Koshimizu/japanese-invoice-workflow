import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { listMembers, listInvoices } from '../../../src/server/service';
import { stripeConfig } from '../../../src/server/config';
import { roleLabels } from '../../../src/core/invoice';
import { MemberRole, UpgradeButton } from './controls';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const s = await pageSession();
  const { deps } = await runtime();
  const members = await listMembers(deps, s);
  const { used } = await listInvoices(deps, s);
  const billing = (await searchParams).billing;
  const limit = s.plan === 'pro' ? 1000 : 30;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {s.role === 'admin' ? 'メンバーとプラン' : 'プランと利用状況'}
          </h1>
          <p className="sub">{s.orgName}</p>
        </div>
      </div>
      {billing === 'success' && (
        <div
          className="alert success"
          role="status"
          style={{ marginBottom: 16 }}
        >
          決済が完了しました。Stripeからの通知を受け取るとProプランに切り替わります。
        </div>
      )}
      <div className="card pad" style={{ marginBottom: 20 }}>
        <h2>プラン</h2>
        <p style={{ margin: '0 0 10px' }}>
          現在：
          <b>
            {s.plan === 'pro' ? 'Pro（月1,000枚まで）' : 'Free（月30枚まで）'}
          </b>{' '}
          ・ 今月 {used} / {limit} 枚
        </p>
        <p className="meta-line" style={{ marginTop: 0 }}>
          上限はデータベースで強制しています。プランの切り替えは、署名を検証したStripeのWebhookでのみ行われます。
        </p>
        {s.role === 'admin' && s.plan === 'free' && (
          <UpgradeButton enabled={!!stripeConfig()} />
        )}
      </div>
      <div className="card">
        <div className="pad" style={{ paddingBottom: 0 }}>
          <h2>メンバー</h2>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>名前</th>
              <th className="hide-sm">メール</th>
              <th>役割</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}</td>
                <td className="hide-sm">{m.email}</td>
                <td>
                  {s.role === 'admin' ? (
                    <MemberRole
                      userId={m.user_id}
                      role={m.role}
                      name={m.name}
                    />
                  ) : (
                    roleLabels[m.role]
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
