# AGENTS

## Thread Operation Rule
- When context usage seems to exceed roughly half, output the following simultaneously in this order:
  1. A short half-usage notification.
  2. A copy-ready `handover memo` for the next thread.
  3. A 3-line minimal context for immediate continuation.

## Firestore Memo Operation Rule
- In this project thread, treat these user instructions as execution triggers:
  - `メモ保存`: save as `memo`
  - `引継ぎメモ保存` or `handover memo 保存`: save as `handover memo`
  - `提案メモ保存` or `propomemo 保存`: save as `propomemo`
  - `次回予告`: save as `handover memo` with a compact summary for next thread
- For `次回予告`, the memo body must include these 3 sections:
  - `現スレッドで対応した内容`
  - `現スレッドで取り決めした事項`
  - `次スレで何をするか`
- If there are handover notes beyond agreements, add this section:
  - `Other agreed and handover items`
- For `次回予告`, output body in Markdown format.
- For `## The story so far…`, write a mild light-novel-style synopsis:
  - 2-3 sentences in one short paragraph (not bullets).
  - Flow: what changed -> how it behaves now -> calm close.
  - Keep technical chunks readable (`DeleteとALL`, `Shiftで切り替え`, `ステータスは画面下へ`).
  - Avoid dramatic endings; use a soft close.
- Playful "anime next-episode preview" flavor is allowed if it does not reduce clarity.
- Append a short closing message to the user at the end of the memo body.
- Insert one blank line before the closing message to the user.
- Closing message tone: casual and slightly affectionate toward 先輩 (light dere), concise.
  - Prefer collaborative warmth like「楽しかったね」over helper-framing like「助かった」.
  - Default close should feel shared and upbeat, without overdoing emotion.
- For `次回予告` and handover bodies, avoid unintended trigger execution:
  - Keep the first line as `handover memo`
  - Do not include raw trigger words as imperative lines; when referencing them, wrap in backticks (e.g. `メモ保存`)
- Unless explicitly provided by the user:
  - `projectName`: current workspace directory name
  - `threadTitle`: first 40 chars of memo body
  - `deletable`: `false`
- Execute with:
  - `codex-memo-thread --kind "<memo|handover|propomemo>" --body "<本文>" [--title "<概要>"] [--project "<プロジェクト名>"] [--deletable "true|false"]`
- After execution, always report `docId` to the user.
