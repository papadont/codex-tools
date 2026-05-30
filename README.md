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

### codex-memo MCP PoC
read-only の stdio MCP server:
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

PoC範囲:
- Firestore `codex-memo` collection の read-only 参照のみ
- 認証、remote 公開、作成/更新/削除 tool は次段階

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
