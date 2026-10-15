// Creates an organization and its first admin in a live database.
//   ORG_ADMIN_PASSWORD='...' npm run org:create -- --org="株式会社〇〇" --email=you@example.com --name="山田 太郎"
import pg from 'pg';
import { hashPassword } from '../src/server/auth';

const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const org = arg('org');
const email = arg('email')?.toLowerCase();
const name = arg('name');
const password = process.env.ORG_ADMIN_PASSWORD;
if (!org || !email || !name || !password)
  throw new Error(
    'Usage: ORG_ADMIN_PASSWORD=... npm run org:create -- --org=... --email=... --name=...',
  );
const client = new pg.Client({
  connectionString: process.env.ADMIN_DATABASE_URL,
});
await client.connect();
try {
  await client.query('BEGIN');
  const o = await client.query<{ id: string }>(
    'INSERT INTO app.organizations (name) VALUES ($1) RETURNING id',
    [org],
  );
  const u = await client.query<{ id: string }>(
    'INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, name, await hashPassword(password)],
  );
  await client.query(`INSERT INTO app.memberships VALUES ($1, $2, 'admin')`, [
    o.rows[0].id,
    u.rows[0].id,
  ]);
  await client.query('COMMIT');
  console.log(`Created ${org} with admin ${email}`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
