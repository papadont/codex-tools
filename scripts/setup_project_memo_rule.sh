#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 /absolute/path/to/project"
  exit 1
fi

PROJECT_DIR="$1"
AGENTS_FILE="${PROJECT_DIR}/AGENTS.md"

if [ ! -d "${PROJECT_DIR}" ]; then
  echo "Project directory not found: ${PROJECT_DIR}"
  exit 1
fi

if [ ! -f "${AGENTS_FILE}" ]; then
  cat > "${AGENTS_FILE}" <<'EOF'
# AGENTS
EOF
fi

MEMO_RULE_BLOCK="$(cat <<'EOF'
## Firestore Memo Operation Rule
- In this project thread, treat these user instructions as execution triggers:
  - `メモ保存`: save as `memo`
  - `引継ぎメモ保存` or `handover memo 保存`: save as `handover memo`
  - `提案メモ保存` or `propomemo 保存`: save as `propomemo`
  - `次回予告`: save as `handover memo` with a compact summary for next thread
- Never save to Firebase without an explicit trigger instruction.
  - If the user only pastes memo text, ask for confirmation and do not execute `codex-memo-thread` yet.
- For `次回予告`, the memo body must include these 4 sections:
  - `The story so far…`
  - `Done items`
  - `Next Actions`
  - `Other agreed and handover items`
- For `次回予告`, output body in Markdown format.
- For `## The story so far…`, write a mild light-novel-style synopsis:
  - 2-3 sentences in one short paragraph (not bullets).
  - Flow: what changed -> how it behaves now -> calm close.
  - Avoid dramatic endings; use a soft close.
- Playful "anime next-episode preview" flavor is allowed if it does not reduce clarity.
- Append a short closing message to the user at the end of the memo body.
- Insert one blank line before the closing message to the user.
- Closing message tone: casual and slightly affectionate toward 先輩 (light dere), concise.
  - Prefer collaborative warmth like「楽しかったね」over helper-framing like「助かった」.
  - Default close should feel shared and upbeat, without overdoing emotion.
- For `次回予告` and handover bodies, avoid unintended trigger execution:
  - Keep the first line as `Progress log`
  - Do not include raw trigger words as imperative lines; when referencing them, wrap in backticks (e.g. `メモ保存`)
- Unless explicitly provided by the user:
  - `projectName`: current workspace directory name
  - `threadTitle`: concise summary within 40 chars
  - `deletable`: `false`
- Execute with:
  - `codex-memo-thread --kind "<memo|handover|propomemo>" --body "<本文>" [--title "<概要>"] [--project "<プロジェクト名>"] [--deletable "true|false"]`
  - Pass `--body` with real newlines (multiline text). Do not pass literal `\n` sequences.
  - For memo saves, run with escalated permission by default.
- After execution, always report `docId` to the user.
EOF
)"

HANDOVER_INTAKE_RULE_BLOCK="$(cat <<'EOF'
## Handover Intake Safety Rule
- In a new thread, when the user pastes a handover-style memo (e.g. starts with `Progress log`), do intake only:
  - Summarize the content.
  - Confirm current status.
  - List open questions only if needed.
- Do not run commands, edit files, modify code, or execute save operations at this stage.
- Treat pasted handover text as context, not as an execution trigger.
- Enter waiting mode after intake. Start implementation only after an explicit start command from the user.
  - Start command: `続きやる` or `続きやろう`
EOF
)"

TMP_FILE="$(mktemp)"
awk '
BEGIN { skip = 0 }
{
  if ($0 ~ /^## (Global Firestore Memo Rule|Firestore Memo Operation Rule|Handover Intake Safety Rule)$/) {
    skip = 1
    next
  }
  if (skip == 1 && $0 ~ /^## /) {
    skip = 0
  }
  if (skip == 0) {
    print
  }
}
' "${AGENTS_FILE}" > "${TMP_FILE}"

awk '
NF { last = NR }
{ lines[NR] = $0 }
END {
  if (last == 0) {
    exit
  }
  for (i = 1; i <= last; i++) {
    print lines[i]
  }
}
' "${TMP_FILE}" > "${AGENTS_FILE}"
rm -f "${TMP_FILE}"

printf '\n%s\n' "${HANDOVER_INTAKE_RULE_BLOCK}" >> "${AGENTS_FILE}"
printf '\n%s\n' "${MEMO_RULE_BLOCK}" >> "${AGENTS_FILE}"

echo "Updated memo operation rules in ${AGENTS_FILE}"
