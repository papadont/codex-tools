# codex-memo share for macOS

macOS の Share Extension から `codex-memo` へ送り込むための共有導線。

今の範囲:
- macOS host app
- macOS Share Extension
- macOS Quick Look Preview Extension for `.md`
- `text` / `url` / `image` / `file attachment` を `http://127.0.0.1:4173/api/memos` へ `POST`

まだ未対応:
- App Group キュー
- 署名/配布まわりの詰め

## 前提
- Xcode 26 以上
- `xcodegen`
- `codex-memo` Web が `http://127.0.0.1:4173` で起動中

## 生成
```bash
cd "/Users/hideki/dev/codex-tools/apps/codex-memo-share-macos"
xcodegen generate
```

## ビルド
```bash
cd "/Users/hideki/dev/codex-tools/apps/codex-memo-share-macos"
./build.sh
```

既定の生成先は `/tmp/codex-memo-share-macos-build`。
`Documents` 配下だと生成物に Finder / File Provider 属性が付いて codesign が落ちることがあるので、repo 外へ逃がしてる。

共有シートに出すための肝:
- `NSExtensionPrincipalClass` は `ShareViewController` の素の class 名にする
- Swift 側でも `@objc(ShareViewController)` を付ける
- Safari の URL 共有は `public.url` だけでなく `public.active-webpage` も拾う

## 使い方
1. `npm run memo:web` で `codex-memo` を起動
2. `codex-memo-share.app` を起動
3. 他アプリで共有メニューから `codex-memo-share` を選ぶ
4. コメントを足して `Post`

## Quick Look
`.md` は app を入れておくと Finder のスペースキー preview で独自表示される。

今の実装:
- ネイティブの Quick Look Preview Extension
- codex-memo 寄りの見た目へ寄せた軽量 formatter
- 対象 content type は `net.daringfireball.markdown`

## 保存 payload
- `projectName`: `share`
- `memoType`: `memo`
- `threadTitle`: 先頭行ベースで自動生成
- `memoBody`: コメント + 共有された text/url/file info + image markdown
- `attachments`: image / file を `dataUrl` 付きで同時送信
- `createdBy`: `codex-memo-share-extension`

## attachment の今の扱い
- image: 実 attachment として保存
- file: 実 attachment として保存し、memo 本文には `attachment://...` link を入れる
- PDF / generic file は `codex-memo` 側で `Download` から取り出せる
- body preview の attachment link も通常 link と同じ見た目で表示される
- 共有元が file 名を渡さないときは `shared-file(.ext)` fallback になる
- `suggestedName` が無いときも、共有元 URL や `file://...` 参照先から元ファイル名を拾いにいく

## 共有元ごとの注意
- iCloud 上の Notes / Files は、macOS 側の仕様で先に Share Link ダイアログが出ることがある
- その場合は実体ではなく共有リンク URL が渡される
- 非 iCloud のローカル file は `codex-memo-share` に直接入りやすい
- Notes 共有は memo 化というより iCloud の共有 URL 保存になりやすい

## 次にやる候補
1. App Group キュー対応
2. 保存先 URL を設定画面で切り替え
3. 署名/配布まわりの詰め
