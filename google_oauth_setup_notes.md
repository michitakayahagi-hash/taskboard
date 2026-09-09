# Google Workspaceログイン導入メモ

- 確認日: 2026-09-04
- Google Cloudプロジェクト: `natural-metric-465909-v9`（表示名: My First Project）
- OAuthクライアント名: `b-bloom 共通 Googleログイン`
- OAuthクライアントID: `630679793893-9ipqvl979ss396tcn47c66guoaon59nv.apps.googleusercontent.com`
- OAuthの対象ユーザー種別: **内部**（Google Workspace）

## 追加・保存済みの許可URI

| 区分 | 値 |
|---|---|
| 承認済みJavaScript生成元 | `https://proactive-caring-production-1be5.up.railway.app` |
| 承認済みリダイレクトURI | `https://proactive-caring-production-1be5.up.railway.app/api/auth/google/callback` |

Google Cloud Console上で上記2項目を入力後、「保存」済み。コンソールは「OAuth クライアントを保存しました」と表示し、設定完了を確認した。

## Railwayに必要な環境変数

| 変数名 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | 上記クライアントID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Consoleの同OAuthクライアントのシークレット（本文・ログには保存しない） |
| `GOOGLE_ALLOWED_DOMAIN` | `b-bloom.jp` |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://proactive-caring-production-1be5.up.railway.app/api/auth/google/callback` |
| `JWT_SECRET` | 既存値を利用（未設定なら十分なランダム値をRailwayの秘密情報として設定） |

## 実装方針

- Google OAuth 2.0 Authorization Codeフローを利用する。
- `state` CookieでCSRF対策を行う。
- Google IDトークンの署名、`aud`、`iss`、`email_verified` を検証する。
- `@b-bloom.jp` のメールアドレスのみ許可する。
- Googleプロフィールの `sub` をアプリ内の `openId` として保存する。
- 同一メールアドレスの既存ユーザーがある場合は同じユーザー行を更新し、既存ロールを維持する。
- プロジェクト単位の閲覧・編集権限は、`project_members.email` とGoogleログインメールアドレスを照合して維持する。
- Googleログイン導入後の新規メンバー登録・招待は、メールアドレスのみで行い、名前・パスワード方式を廃止する。

> クライアントシークレットは秘密情報のため、このファイルやGitHubへ保存しない。

## 参照

- Google Cloud Console OAuthクライアント: https://console.cloud.google.com/auth/clients/630679793893-9ipqvl979ss396tcn47c66guoaon59nv.apps.googleusercontent.com?project=natural-metric-465909-v9
- ユーザー提供資料: `/home/ubuntu/upload/Google_Workspaceログイン導入：他アプリへの引き継ぎテンプレート.pdf`
