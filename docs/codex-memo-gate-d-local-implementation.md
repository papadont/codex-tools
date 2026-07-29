# codex-memo Gate D local implementation

- Status: Local implementation complete — production approval pending
- Date: 2026-07-30
- Contract owner: `codex-memo-macos/docs/gate-d-editor-metadata-contract.md`
- Production deployment: Not performed
- Production write canary: Not performed

Gate D adds optional `projectName` and `memoType` fields to the existing
conflict-safe `PUT /sites-api/memos/:id` contract. Existing text-only requests
remain compatible.

## Local implementation

- `memo.updateMetadata.conflictSafe: true` is advertised with contract revision
  `2026-07-30`.
- `projectName` must be a non-empty string when supplied.
- `memoType` must be one of the advertised `memoTypes`.
- omitted metadata fields preserve their current values.
- text and metadata fields update in one Firestore transaction guarded by
  `expectedUpdatedAtISO`.
- stale revisions return `409 UPDATE_CONFLICT` with the current public memo.
- internal storage fields and attachment state are not writable through this
  request.

The transaction implementation lives in `scripts/memo_service.js`; the Sites
API performs request validation and public response shaping in
`scripts/codex_memo_sites_api.mjs`.

## Local verification

The focused Sites API, memo service, MCP core, and Remote MCP regression suite
passes. The tests cover:

- metadata and text atomic update
- field omission
- invalid metadata
- stale revision with no partial update
- capabilities
- existing Sites API, MCP, and attachment paths

The full repository suite must pass before commit.

## Production boundary

No Cloud Run deploy, traffic change, Secret change, IAM change, or production
write is authorized by this local implementation approval. Production rollout
and a controlled metadata update canary require separate approval.
