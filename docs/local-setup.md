# 実運用モードとローカル環境

## 1. PostgreSQL

```sh
npm run db:up            # Docker Composeで PostgreSQL 17 を起動し、スキーマとロールを適用
cp .env.example .env.local
```

`.env.local` の `APP_MODE=live` にし、`APP_ORIGIN`（ブラウザで開くURLの `https://ホスト名`。ローカルは `http://127.0.0.1:3000`）とAIの設定を入れます。`APP_ORIGIN` は同一オリジンの検査、cookieのSecure属性、Stripeの戻り先に使います。アプリは `invoice_app`（スーパーユーザーではなく、`app_user` のメンバーで、テーブルを所有しないロール）で接続します。起動時にこの条件を満たさない接続は拒否します。

Dockerを使わない場合は、任意のPostgreSQL（Supabase、Neon等）に `db/schema.sql` を適用し、`app_user` のメンバーのログインロールを作って `DATABASE_URL` に設定してください。

## 2. 組織と利用者

```sh
npm run db:seed-demo                  # 公開デモと同じ架空データを入れる場合
ORG_ADMIN_PASSWORD='10文字以上' npm run org:create -- --org="株式会社〇〇" --email=you@example.com --name="山田 太郎"
```

## 3. AI

| プロバイダー         | 設定                                                                 | 対応形式       |
| -------------------- | -------------------------------------------------------------------- | -------------- |
| Claude               | `EXTRACTION_PROVIDER=claude`、`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` | PDF・PNG・JPEG |
| ChatGPT（Codex CLI） | `EXTRACTION_PROVIDER=codex`、`CODEX_MODEL`、`codex login` 済み       | PNG・JPEG      |

Codexは一時ディレクトリの読み取り専用サンドボックスで、ツール・シェル・ブラウザ等を無効にして構造化JSONだけを受け取ります。2026-10-20にmacOSのCodex CLI 0.162.1で、40枚の画像の読み取りを確認しています（[検証記録](verification.md)）。

どちらのプロバイダーも、1回の読み取りで2回独立に読ませて読み比べます（食い違えば3回目、[ADR 005](adr/005-consensus-reading.md)）。AIの呼び出しは1枚につき9回までです。

## 4. 評価

```sh
npm run eval                          # 40枚すべて
npm run eval -- --ids=inv-29,inv-35   # 一部（レポートは部分評価と明記）
npm run eval:pipeline                 # AIを使わない仕組みの確認（精度ではない）
```

`reports/eval-*.json` に、モデル・コミット・評価データとプロンプトのSHA-256・項目別の正誤・読み違えた項目の値・正しい請求書への誤検出・時間・トークン数を保存します。3回続けて失敗すると途中結果を保存して止まります。

## 5. Stripe（任意・テストモード）

1. Stripeのテストモードで月額のPriceを作り、`STRIPE_PRICE_PRO` に設定
2. `STRIPE_SECRET_KEY`（`sk_test_...`）を設定
3. `stripe listen --forward-to localhost:3000/api/stripe/webhook` で表示される `whsec_...` を `STRIPE_WEBHOOK_SECRET` に設定
4. 管理者で「メンバーとプラン」からアップグレードし、テストカードで決済

プランはWebhookでのみ切り替わります。

## 6. 公開デモをVercelに置く

画面とAPIが別々のインスタンスで動くため、デモ専用のPostgreSQLを `DEMO_DATABASE_URL`（任意で直結用の `DEMO_DATABASE_URL_UNPOOLED`）に設定します。初回の起動でスキーマと架空データを作り、1日ごと、または管理者の「デモを初期化」で元に戻します。そのDBの中身はすべて消えるので、デモ専用にしてください。

```sh
vercel integration add neon --plan free_v3 --prefix DEMO_ -e production --no-env-pull
vercel deploy --prod
```

`vercel.json` のビルドで、アプリ全体を1つの関数として動かします（[ADR 003](adr/003-demo-without-ai.md)）。

## 7. テスト

```sh
npm run format:check && npm run typecheck && npm run build
RUN_POSTGRES_TESTS=1 npm test                                # db:up の後。単体・DB・実PostgreSQL
npx playwright install chromium webkit && npm run test:e2e   # 画面・axe・25種の画面の大きさ（Chromium・WebKit）
```

Docker以外のPostgreSQLで試すときは、`db/schema.sql` と `db/local-roles.sql` を適用し、`DATABASE_URL`（`invoice_app`）と `ADMIN_DATABASE_URL`（所有者）を指定します。画面のテストはポート3012でサーバーを起動します（`E2E_PORT` で変更可）。Chromiumを自分で用意する場合は `CHROMIUM_EXECUTABLE_PATH` を指定します。

## 8. 評価用の請求書を作り直す

```sh
CHROMIUM_EXECUTABLE_PATH=... npm run invoices:generate   # HTMLからPDF・PNGを生成し、誤りの検出を自己検査
npm run fixtures:build                                    # 公開デモ用の事前データを再生成
```
