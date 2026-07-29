# codex-memo Gate D production rollout

- Status: Deployed and verified
- Date: 2026-07-30
- Deploy source revision: `054ba15514d5aa1f408648b308f033082e2d93bf`
- Google Cloud project: `hush-pointer`
- Region: `us-central1`
- Cloud Run service: `codex-memo-remote-mcp`
- Pre-deploy revision: `codex-memo-remote-mcp-00011-sev`
- Production revision: `codex-memo-remote-mcp-00014-tat`
- Rollback revision: `codex-memo-remote-mcp-00011-sev`
- Production image digest:
  `sha256:c33ecc251472ddf336798aac87503c0dd5b31c68798cecdfd3772f04eda89007`
- Production URL:
  `https://codex-memo-remote-mcp-iag5i32zba-uc.a.run.app`

2026-07-30にGate D本番デプロイとcontrolled metadata update canaryの
明示承認を受け、以下を完了した。

## 変更範囲

- `PUT /sites-api/memos/:id`のoptional `projectName`／`memoType`
- `memo.updateMetadata.conflictSafe: true`
- contract revision `2026-07-30`
- textとmetadataの同一Firestore transaction更新

次は変更していない。

- Firebase project、Firestore database、Storage bucket
- Firestore／Storage Security Rules
- service account、IAM binding、Cloud Run ingress
- Secret名、Secret version、Secret値
- OAuth、Remote MCP、Sites APIの認証設定
- TTL policy

## Preflight

- production traffic: `codex-memo-remote-mcp-00011-sev`へ100%
- invoker IAM check: disabled
- service account:
  `codex-memo-remote-mcp@hush-pointer.iam.gserviceaccount.com`
- Sites API key: Secret `codex-memo-sites-api-key:2`
- min instances `0`、max instances `1`
- CPU `1`、memory `512Mi`、timeout `60s`
- ingress `all`
- `codex-memo-sites-idempotency-v1.expiresAt` TTL: `ACTIVE`

Secret値は取得結果へ出力・記録していない。

## Candidate

`codex-memo-remote-mcp-00014-tat`をtraffic 0%、
tag `gate-d-candidate`でdeployした。

- pre-deploy revisionとservice account、resource、env、Secret参照が一致
- Ready condition `True`
- health `200`
- unauthenticated capabilities `401 UNAUTHORIZED`
- authenticated capabilities `200`
- `apiVersion: 1`
- contract revision `2026-07-30`
- `memo.updateMetadata.conflictSafe: true`
- authenticated memo list `200`
- unauthenticated Remote MCP `401`
- candidate ERROR log `0`

この段階ではwriteを行っていない。

## Production result

candidate smoke成功後、`codex-memo-remote-mcp-00014-tat`へtrafficを100%切り替えた。

- production health `200`
- authenticated capabilities `200`
- authenticated memo list `200`
- unauthenticated Remote MCP `401`
- authenticated Remote MCPの既存5 toolsを確認
- rollout後ERROR log `0`
- TTL `ACTIVE`
- candidate tag削除済み

## Controlled metadata update canary

一時的なdeletable memo 1件で次を確認した。

1. create `201`
2. Project、Memo Type、本文、タイトルのatomic update `200`
3. text-only updateでProject／Memo Type保持 `200`
4. stale revisionの全field updateが`409 UPDATE_CONFLICT`
5. GETのcurrent revisionと409 responseが一致 `200`
6. 確認付きdelete `200`
7. delete後GET `404`

cleanup後、canary projectに一致するmemoは0件。capture tombstoneは
idempotency契約どおり残る。memo本文、memo ID、capture ID、Secret値は記録していない。

## Rollback

問題が見つかった場合は再buildせず次で戻せる。

```sh
gcloud run services update-traffic codex-memo-remote-mcp \
  --project hush-pointer \
  --region us-central1 \
  --to-revisions=codex-memo-remote-mcp-00011-sev=100
```

rollback後はhealth、Remote MCP、Sites API read endpointを再確認する。
旧revisionはmetadata capabilityをadvertiseしないため、macOS clientは
metadata PUTを送らずローカル下書きを保持する。
