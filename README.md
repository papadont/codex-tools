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

## ディレクトリ構成（要点）
```text
apps/
  codex-tools-menubar/
    build.sh
    main.swift
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
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcp/codex-tools-firestore-sa.json"
```

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
