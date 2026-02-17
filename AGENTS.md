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
- Unless explicitly provided by the user:
  - `projectName`: current workspace directory name
  - `threadTitle`: first 40 chars of memo body
  - `deletable`: `false`
- Execute with:
  - `codex-memo-thread --kind "<memo|handover|propomemo>" --body "<本文>" [--title "<概要>"] [--project "<プロジェクト名>"] [--deletable "true|false"]`
- After execution, always report `docId` to the user.
