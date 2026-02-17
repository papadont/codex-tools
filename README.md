# codex-tools

Codexアプリ向けの共通ツール保守プロジェクト。
第一号として Firestore メモ保存ツール `codex-memo` を管理します。

## 移管完了メモ（2026-02-16）

- 保守先を `codex-tools` に移管完了（旧 `codexQA` は移管案内のみ）
- グローバルコマンド導入確認:
  - `~/.codex/bin/codex-memo-save`
  - `~/.codex/bin/codex-memo-thread`
- Firestore 書き込み確認済み（`codex-memo` collection）
  - `memo`
  - `handover memo`
  - `propomemo`

### 確認済みの最小手順

```bash
export PATH="$HOME/.codex/bin:$PATH"
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcp/codex-tools-firestore-sa.json"
```

```bash
codex-memo-thread --kind "memo" --body "移管後テスト"
codex-memo-thread --kind "handover" --body "移管後テスト: handover"
codex-memo-thread --kind "propomemo" --body "移管後テスト: propomemo"
```

## codex-memo の保存先と項目

- Collection: `codex-memo`
- Fields:
  - `projectName`
  - `datetime` (Firestore Timestamp)
  - `memoType` (`handover memo` / `memo` / `propomemo`)
  - `memoBody`
  - `threadTitle`
  - `deletable` (boolean)
  - `createdAtISO`
  - `createdBy`
  - `sourceThread`

## セットアップ

```bash
cd /Documents/develop/codex-tools
npm install
```

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
```

## ローカル実行

```bash
npm run memo:save -- \
  --projectName "any-project" \
  --memoType "memo" \
  --memoBody "保存本文" \
  --threadTitle "スレッド概要" \
  --deletable "false"
```

```bash
npm run memo:thread -- \
  --kind "handover" \
  --body "次スレでやること"
```

## codex-memo 管理Webアプリ

Firestoreの `codex-memo` collection を閲覧/編集/削除/ダウンロードできるローカルWeb UI。

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
npm run memo:web
```

起動後:

- [http://localhost:4173](http://localhost:4173)
- 機能:
  - 一覧・検索
  - 新規作成・編集・削除
  - ダウンロード (`txt` / `md` / `json`)
  - 共有（Web Share API, LINE送信導線）

## グローバル導入

```bash
/Documents/develop/codex-tools/scripts/install_global_memo_tool.sh
```

必要ならPATH追加:

```bash
export PATH="$HOME/.codex/bin:$PATH"
```

## 各プロジェクトへルール追記

```bash
/Documents/develop/codex-tools/scripts/setup_project_memo_rule.sh /absolute/path/to/project
```
