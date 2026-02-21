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
cd "$HOME/Documents/develop/codex-tools"
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

## deletable 運用ルール（2026-02-18）

- 初期値は常に `deletable=false`。
- `deletable=true` にする責任者は「そのメモを今スレで消してよいと判断した人」。
- 削除ガード:
  - `deletable=true` のメモだけ削除可能。
  - 削除時は `DELETE` 確認トークンが必須（UIで入力）。
  - `pinned=true` と `deletable=true` は同時に不可。
- 推奨フロー:
  1. 通常は `deletable=false` のまま運用。
  2. 削除候補になった時だけ `DEL` をON。
  3. 即削除する（削除後は再作成しない限り復元不可）。

## 次スレ移動（handover選択）

```bash
npm run memo:pick-handover
```

- 現在プロジェクト名の `handover memo` を降順表示
- 番号選択で `memoBody` を出力

```bash
npm run memo:pick-handover -- --index "1"
```

- 非対話で1件目（最新）を選択

Action handover 用テキスト案:

```text
Keep going with handover pickup for the current project.

1) 今いるプロジェクトに新規スレッドを作成する。
2) codex-memo から current project の handover memo 一覧を作る。
3) タイトルを番号付きダイアログで降順表示する。
4) ユーザーが選んだ番号の memoBody を新規スレッドに貼り付ける。
5) もし新規スレッド作成APIが使えない場合は、memoBodyをそのまま表示して貼り付けを促す。

制約:
- メモ本文に「次回予告」という語を含めない。
- 本文先頭は "Progress log" を維持する。

次スレ貼り付け用テンプレ（不要トリガー回避版）:

```md
Progress log

## The story so far…
（2〜3文の短い段落で、起:変化 -> 承:動作 -> 結:落ち着いた締め。ライトノベル風はマイルドに）

## Done items
- （完了事項）

## Next actions
- （次アクション）

## Other agreed and handover items
- （合意済みルール）
- （取り決め事項以外のその他引き継ぎ事項があればここ）

メモ:
- 実行トリガー語は説明時にバッククォートで囲む（例: `メモ保存`）。

**先輩へ** （ここに短く、少しデレ寄りの締めメッセージ。例: 「一緒に詰められて楽しかったね」）
```

## グローバル導入

```bash
"$HOME/Documents/develop/codex-tools/scripts/install_global_memo_tool.sh"
```

必要ならPATH追加:

```bash
export PATH="$HOME/.codex/bin:$PATH"
```

## 各プロジェクトへルール追記

```bash
"$HOME/Documents/develop/codex-tools/scripts/setup_project_memo_rule.sh" /absolute/path/to/project
```
