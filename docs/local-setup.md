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

Codexは一時ディレクトリの読み取り専用サンドボックスで、ツール・シェル・ブラウザ等を無効にして構造化JSONだけを受け取ります。この環境ではCodex CLIでの画像入力を実行して確認していません。

## 4. 評価

```sh
npm run eval                          # 40枚すべて
npm run eval -- --ids=inv-29,inv-35   # 一部（レポートは部分評価と明記）
npm run eval:pipeline                 # AIを使わない仕組みの確認（精度ではない）
```

`reports/eval-*.json` に、モデル・コミット・評価データとプロンプトのSHA-256・項目別の正誤・時間・トークン数を保存します。3回続けて失敗すると途中結果を保存して止まります。

## 5. Stripe（任意・テストモード）

1. Stripeのテストモードで月額のPriceを作り、`STRIPE_PRICE_PRO` に設定
2. `STRIPE_SECRET_KEY`（`sk_test_...`）を設定
3. `stripe listen --forward-to localhost:3000/api/stripe/webhook` で表示される `whsec_...` を `STRIPE_WEBHOOK_SECRET` に設定
4. 管理者で「メンバーとプラン」からアップグレードし、テストカードで決済

プランはWebhookでのみ切り替わります。

## 6. テスト

```sh
npm run typecheck && npm test && npm run build
npx playwright install chromium && npm run test:e2e
RUN_POSTGRES_TESTS=1 npx vitest run tests/postgres.test.ts   # db:up の後
```

Playwrightのブラウザを取得できない環境では、`CHROMIUM_EXECUTABLE_PATH` に任意のChromiumを指定できます。

## 7. 評価用の請求書を作り直す

```sh
CHROMIUM_EXECUTABLE_PATH=... npm run invoices:generate   # HTMLからPDF・PNGを生成し、誤りの検出を自己検査
npm run fixtures:build                                    # 公開デモ用の事前データを再生成
```
