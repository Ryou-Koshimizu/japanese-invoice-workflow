# ADR 002：認証とファイル保存を外部サービスに依存させない

## 判断

- 認証はメールとパスワード（scrypt、N=16384）とサーバー側セッション（トークンはSHA-256で保存、httpOnly・SameSite=Laxのcookie、12時間）。
- ファイルはPostgreSQLに保存（10MBまで）。
- 状態を変えるAPIはOriginを検査する。ログインはメール＋接続元ごとに5回で5分止める。

## 理由

clone直後に外部アカウントなしで全機能を試せることを優先した。どのPostgreSQL（Supabase、Neon、RDS）でも動く。

## 代償と移行

- SSO・パスワードリセット・多要素認証はない。本番ではSupabase Auth等に置き換える前提で、`sessionFromToken()` が差し替え境界。
- ファイルが増えるとDBが重くなる。S3等に移す場合は `invoice_files` を参照に置き換える。
- ログイン制限はプロセス内のメモリで、複数台構成では共有されない。
