# codex-tools

Codex周辺ツールをまとめる保守用リポジトリ。

## このプロジェクトに属するアプリ
- `codex-tools.app`:
  - メニューバー常駐アプリ
  - `hush-pointer` / `codex-memo` 起動制御
  - Codex 1w reset 表示（`dist/usage-reports/weekly/latest.json` 参照）
- `codex-memo` (Web):
  - Firestore `codex-memo` を閲覧/編集/削除/ダウンロード
  - 起動URL: [http://localhost:4173](http://localhost:4173)
- `codex-memo-share-macos`:
  - macOS Share Extension の土台
  - `text` / `url` を `codex-memo` の `/api/memos` へ送る

## 分離済みプロジェクト
- Codex pet の制作・改造・検証は `../codex-pets-lab` に移管済み。
- この repo では `pet-runs/` を管理しない。

## ディレクトリ構成（要点）
```text
apps/
  codex-tools-menubar/
    build.sh
    main.swift
  codex-memo-share-macos/
    project.yml
    HostApp/
    ShareExtension/
  legacy-dual-launcher/
    build.sh

codex-memo-web/
  public/

scripts/
  ... memo/usage/運用スクリプト
  build_menubar_launcher_app.sh   # 互換ラッパー
  build_dual_launcher_app.sh      # 互換ラッパー

dist/
  macos-launchers/
  usage-reports/weekly/
```

## セットアップ
```bash
cd "$HOME/Documents/develop/codex-tools"
npm install
```

`.env` を置くと Web/CLI 両方で自動読込される。

```bash
cp .env.example .env
```

最低限:
```bash
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcp/codex-tools-firestore-sa.json"
CODEX_MEMO_FIREBASE_BUCKET="your-project.firebasestorage.app"
```

任意:
```bash
OPENAI_ADMIN_KEY="sk-admin-..."
GEMINI_API_KEY="AIza..."
USD_TO_JPY="150"
USAGE_OVERVIEW_SUMMARY_MODE="local"
USAGE_OVERVIEW_SUMMARY_PROVIDER="openai"
USAGE_OVERVIEW_SUMMARY_MODEL="gpt-4o-mini"
MEMO_SUMMARY_PROVIDER="openai"
MEMO_SUMMARY_MODEL="gpt-4.1-nano"
```
- `OPENAI_ADMIN_KEY` を入れると usage パネルで OpenAI API の 30日コストも表示する
- 未設定時は OpenAI API cost は `unavailable` 表示になる
- `USD_TO_JPY` を入れると OpenAI cost の円換算レートを上書きできる
- `USAGE_OVERVIEW_SUMMARY_MODE=ai` で overview 要約にAIを使う
- `USAGE_OVERVIEW_SUMMARY_PROVIDER=openai|gemini` で overview 要約の実行先を選べる（`gemini` は `GEMINI_API_KEY` が必要）
- `USAGE_OVERVIEW_SUMMARY_MODEL` で overview 要約のモデルを上書きできる
- `MEMO_SUMMARY_PROVIDER=openai|gemini` で通常メモ要約の実行先を選べる（`gemini` は `GEMINI_API_KEY` が必要）
- `MEMO_SUMMARY_MODEL` で通常メモ要約のモデルを上書きできる

`local-template(...)` に落ちるときは、`/api/runtime-config` の `usageOverviewSummaryMode` と `hasGeminiSummaryKey` を確認する（`mode!=ai` / `no-gemini-key` の切り分け用）。

Firebase Storage をまだ有効化していない場合:
- Firebase Console で Storage を有効化
- バケット名を確認して `.env` の `CODEX_MEMO_FIREBASE_BUCKET` に入れる
- 必要なら service account に Storage 参照権限を付与する

## よく使うコマンド

### アプリ
```bash
npm run app:build
open "$HOME/Documents/develop/codex-tools/dist/macos-launchers/codex-tools.app"
```

### codex-memo Web
```bash
npm run memo:web
```

プロジェクト直下の `.env` も自動読込される。

固定adapterで起動:
```bash
npm run memo:web:icloud
npm run memo:web:firebase
```

Storage 接続確認:
```bash
npm run firebase:storage:check
```

### codex-memo MCP
read-only のローカル stdio MCP server:
```bash
npm run memo:mcp
```

公開 tool:
- `list_recent_memos`
- `search_memos`
- `get_memo`

MCP client 設定例:
```json
{
  "mcpServers": {
    "codex-memo": {
      "command": "npm",
      "args": ["run", "memo:mcp", "--silent"],
      "cwd": "/Users/hideki/Documents/develop/codex-tools",
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/hideki/.config/gcp/codex-tools-firestore-sa.json"
      }
    }
  }
}
```

stdio版は Firestore `codex-memo` collection の read-only 参照のみ。

#### Remote MCP（Perplexity / ChatGPT）

Remote版はStreamable HTTPで、Perplexity向け固定APIキー認証とChatGPT向けOAuth認証を
併用できる。以下を公開する。

- `list_recent_memos`
- `search_memos`（直近最大500件のみ）
- `get_memo`
- `create_memo`
- `update_memo`（`expectedUpdatedAtISO`による競合防止付き）

ローカル起動:

```bash
CODEX_MEMO_REMOTE_API_KEY="replace-with-long-random-value" \
CODEX_MEMO_ALLOWED_ORIGINS="https://www.perplexity.ai" \
npm run memo:mcp:remote
```

- endpoint: `http://localhost:8080/mcp`
- health check: `http://localhost:8080/health`
- `Origin`がある場合は`CODEX_MEMO_ALLOWED_ORIGINS`との完全一致が必要
- `Origin`なしのサーバー間通信は、有効なBearer APIキーがあれば許可
- 添付は安全なメタデータのみ返し、署名URL・実ファイル・`storagePath`は公開しない

ChatGPTから接続する場合は、OAuth 2.1対応の認可サーバーを用意し、Remote MCPを
resource serverとして設定する。固定APIキー経路はそのままPerplexity用に残る。

```bash
CODEX_MEMO_REMOTE_API_KEY="perplexity-api-key" \
CODEX_MEMO_PUBLIC_BASE_URL="https://memo.example.com" \
CODEX_MEMO_OAUTH_ISSUER="https://auth.example.com/" \
CODEX_MEMO_OAUTH_JWKS_URL="https://auth.example.com/.well-known/jwks.json" \
CODEX_MEMO_OAUTH_REQUIRED_SCOPES="codex-memo" \
CODEX_MEMO_OAUTH_AUDIENCE="https://memo.example.com/mcp" \
npm run memo:mcp:remote
```

- Protected Resource Metadata:
  `https://memo.example.com/.well-known/oauth-protected-resource/mcp`
- 認可サーバーはissuer配下のOAuth Authorization Server Metadataを公開する
- Auth0などJWT access tokenを発行する認可サーバーではJWKS URLを設定する
- opaque access tokenの場合はintrospection URLとresource server用client credentialsを設定する
- `CODEX_MEMO_OAUTH_AUDIENCE`を設定した場合、`aud`または`resource`の一致も必須
- OAuth経由でproject未指定のメモを作ると`projectName`は`chatgpt`になる

Cloud Runへ手動デプロイする例:

```bash
PROJECT_ID="your-project-id"
REGION="asia-northeast1"
SERVICE="codex-memo-remote-mcp"
BUCKET="your-project.firebasestorage.app" # gs:// prefixなし
SECRET="codex-memo-remote-api-key"
SERVICE_ACCOUNT="codex-memo-remote-mcp"
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --display-name="codex-memo Remote MCP"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/datastore.user"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/storage.objectAdmin"

gcloud secrets create "$SECRET" --replication-policy=automatic
printf '%s' "replace-with-long-random-value" | \
  gcloud secrets versions add "$SECRET" --data-file=-
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  --no-invoker-iam-check \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 60 \
  --set-env-vars CODEX_MEMO_FIREBASE_BUCKET="$BUCKET",CODEX_MEMO_ALLOWED_ORIGINS="https://www.perplexity.ai" \
  --set-secrets CODEX_MEMO_REMOTE_API_KEY="$SECRET:latest"
```

上記ではRemote MCP専用サービスアカウントへ、Firestore読み書き、Storage object操作、
対象Secretの参照権限だけを付与する。Cloud RunではADCを使うため、
`GOOGLE_APPLICATION_CREDENTIALS`は設定しない。再デプロイ時は、既存Secretへ新しいversionを追加し、
サービスアカウントとIAM bindingの作成コマンドは省略する。
`--no-invoker-iam-check`は、PerplexityのBearer APIキーをCloud Run IAMではなく
Remote MCPアプリ側で検証するために必要。

デプロイ後:

```bash
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
curl "$SERVICE_URL/health"
```

PerplexityのCustom Remote Connectorには`$SERVICE_URL/mcp`を登録し、認証方式はAPI Keyを選ぶ。
実接続で送信される`Origin`が異なる場合は、確認した値だけを
`CODEX_MEMO_ALLOWED_ORIGINS`へ追加する。

ChatGPTではSettings → Apps → Advanced settingsでDeveloper modeを有効化し、
Create appから`$SERVICE_URL/mcp`を登録して認証方式にOAuthを選ぶ。認可サーバー側には
ChatGPT用OAuth clientを登録し、scope `codex-memo`とresource `$SERVICE_URL/mcp`を許可する。
Cloud Runでは`CODEX_MEMO_OAUTH_CLIENT_SECRET`もSecret Managerから渡す。

コスト事故防止として、月額500円の予算アラートとArtifact Registryの古いイメージ削除ルールを
Google Cloud Consoleで設定する。初回接続が60秒以内に成立しない場合だけ
Cloud Runの`min-instances`を`1`へ変更する。

### メモ保存
```bash
npm run memo:thread -- --kind "memo" --body "sample"
npm run memo:thread -- --kind "handover" --body "sample"
npm run memo:thread -- --kind "propomemo" --body "sample"
```

### usage 取得と自動化
```bash
npm run usage:weekly
npm run usage:weekly:install
```

- 毎週土曜 00:00 に usage スナップショットを更新
- 週次更新時に「Codex 1w reset の10分前」1回実行ジョブを再設定
- 1回実行時に `projectName=usage`, `memoType=memo` で usage 詳細メモを作成

## codex-memo の保存先
- Collection: `codex-memo`
- 主なフィールド:
  - `projectName`
  - `datetime` (Firestore Timestamp)
  - `memoType` (`handover memo` / `memo` / `propomemo`)
  - `memoBody`
  - `threadTitle`
  - `deletable`
  - `createdAtISO`
  - `createdBy`
  - `sourceThread`

### iCloud / Firebase attachment 実体保存先
- `iCloud`: `~/Library/Mobile Documents/com~apple~CloudDocs/codex-memo/<memoId>/`
- `Firebase`: `CODEX_MEMO_FIREBASE_BUCKET` の `memos/<memoId>/attachments/<attachmentId>.<ext>`
- 配下:
  - `iCloud`: `body.md`
  - `iCloud`: `attachments.json`
  - `iCloud`: `attachments/<attachmentId>.<ext>`
  - `Firebase`: Cloud Storage object

### attachments Phase 1 ルール
- 本文の画像参照は `![caption](attachment://<attachmentId>)`
- Firestore には本文と attachment メタだけを保存
- `iCloud` / `Firebase` は attachment 実体も保存
- 本文にある `attachment://id` は、同じ `attachments` メタが無いと保存エラー
- `iCloud` では、upload データが無い既存 attachment は実ファイルが見つからないと保存エラー
- `Firebase` では `storagePath` に Cloud Storage の object path を保存し、signed URL は保存しない

### mixed モードの扱い
- 一覧 / 詳細 / 検索は Firestore の `codex-memo` を正とする
- 有効な保存先は `icloud` / `firebase` のみ
- `storageKind=icloud|firebase` のメモは、保存時に Firestore メタと adapter 実体を同時更新する
- attachment 配信は `storageKind` に応じて iCloud 実体または Firebase signed URL redirect を使う
- 既存メモの `storageKind` migration は `iCloud <-> Firestore` のみ対応
- migration は既存メモを開いたときの `thread` 右側セレクトで切り替えて `Save` する
- migration 後は Firestore メタと target 側 `attachments.json` / Cloud Storage object path を同期する
- `storageKind=local` の既存メモは一覧対象外

### 保存先の上書き
- `CODEX_MEMO_ICLOUD_DIR=/absolute/path`
- `CODEX_MEMO_FIREBASE_BUCKET=<bucket-name>`

例:
```bash
CODEX_MEMO_ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/MyMemo" npm run memo:web:icloud
CODEX_MEMO_FIREBASE_BUCKET="your-project.firebasestorage.app" npm run memo:web:firebase
```

## 補助コマンド
```bash
npm run memo:pick-handover
npm run firestore:usage
```

## 既存プロジェクトへのルール追記
```bash
"$HOME/Documents/develop/codex-tools/scripts/setup_project_memo_rule.sh" /absolute/path/to/project
```

## グローバル導入
```bash
"$HOME/Documents/develop/codex-tools/scripts/install_global_memo_tool.sh"
export PATH="$HOME/.codex/bin:$PATH"
```
