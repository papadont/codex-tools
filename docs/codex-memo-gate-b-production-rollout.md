# codex-memo Gate B production rollout

- Status: Deployed and verified
- Prepared: 2026-07-29
- Target implementation revision: `2e1bfa28313298c93bc03c4d5fc6f6c91a1314c5`
- Deploy source revision: `98ff7b5e0135fad920ef507ea4928802b0122656`
- Google Cloud project: `hush-pointer`
- Region: `us-central1`
- Cloud Run service: `codex-memo-remote-mcp`
- Pre-deploy revision: `codex-memo-remote-mcp-00008-k57`
- Production revision: `codex-memo-remote-mcp-00011-sev`
- Rollback revision: `codex-memo-remote-mcp-00008-k57`
- Pre-deploy image digest:
  `sha256:fa239a20c283580bdfc39ea5a146c8db0804bd0de37cace3594417fd7902a1e4`
- Production image digest:
  `sha256:c413bbc73ef51090fcd856181319eef8d49d640c0295c8494f02497dbb929305`
- Production URL:
  `https://codex-memo-remote-mcp-iag5i32zba-uc.a.run.app`

このrunbookはGate B server revisionを本番へ反映するための承認単位を固定する。
2026-07-29に本番デプロイとcontrolled write canaryの明示承認を受け、以下の手順を完了した。

## 変更範囲

本番変更は次の2点だけ。

1. `codex-memo-remote-mcp`へtarget revisionをsource deployする
2. Firestore collection group
   `codex-memo-sites-idempotency-v1`の`expiresAt`へTTL policyを有効化する

deployにより次のAPI差分が有効になる。

- authenticated `GET /sites-api/capabilities`
- `captureID`付きmemo createのtransactional idempotency
- attachment upload/deleteのpreconditionとmutation receipt
- machine-readable error codeとrequest ID

次は変更しない。

- Firebase project、Firestore database、Storage bucket
- Firestore／Storage Security Rules
- service account、IAM binding、Cloud Run ingress
- Remote MCP API key、Sites API key、OAuth設定
- macOS clientのwrite worker

## Pre-deploy構成のread-only確認

2026-07-29に次を確認した。

- service account:
  `codex-memo-remote-mcp@hush-pointer.iam.gserviceaccount.com`
- Cloud Run: min instances `0`、max instances `1`、CPU `1`、memory `512Mi`、
  timeout `60s`、startup CPU boost有効
- traffic: `codex-memo-remote-mcp-00008-k57`へ100%
- `CODEX_MEMO_REMOTE_API_KEY`:
  Secret `codex-memo-remote-api-key:latest`
- `CODEX_MEMO_SITES_API_KEY`:
  Secret `codex-memo-sites-api-key:2`
- `codex-memo-sites-idempotency-v1`のTTL policy: 未設定

Secret値は取得・記録しない。今回のdeployでSecret versionを追加・変更しない。

## Production result

2026-07-29に次を完了した。

- `codex-memo-remote-mcp-00011-sev`をtraffic 0%のtag付きcandidateとしてdeploy
- candidateのservice account、Secret参照、environment、resource、scaling、
  ingressがpre-deploy snapshotと一致
- candidate URLのhealth、認証、capabilities、memo read smokeが成功
- `codex-memo-sites-idempotency-v1.expiresAt`のTTL stateが`ACTIVE`
- production trafficを`00011-sev`へ100%切り替え
- production URLのhealth、認証、capabilities、memo read smokeが成功
- Remote MCPの既存5 toolsとunauthenticated 401を確認
- controlled write canaryとcleanupが成功
- candidate tagを削除
- revision `00011-sev`のdeploy後ERROR logは0件

controlled write canary:

- memo create: `201`
- 同一capture retry: `200`、同一memo ID、`replayed: true`
- image upload: `201`
- 同一uploadをstale preconditionでretry: `200`、attachment 1件
- attachment delete: `200`
- 同一deleteをstale preconditionでretry: `200`
- memo cleanup: `200`
- 削除済みcapture retry: `409 IDEMPOTENCY_KEY_REUSED`
- cleanup後memo: `404 MEMO_NOT_FOUND`
- cleanup後Storage object: 0件
- capture receipt: 期限なし
- attachment upload／delete receipt: `expiresAt`あり

canaryのmemo本文、attachment、API keyは記録していない。test memoとStorage objectは削除済み。
仕様上必要なcapture tombstone 1件と、TTL対象のattachment receipt 2件だけが残る。

## Gate C attachment preview IAM follow-up

2026-07-29のmacOS Host App Gate Cで、attachment resolveが
`iam.serviceAccounts.signBlob`不足により`500`になることを確認した。
Cloud Run runtime service account
`codex-memo-remote-mcp@hush-pointer.iam.gserviceaccount.com`自身へ、
最小のself-bindingとして`roles/iam.serviceAccountTokenCreator`を追加した。

変更後は同じproduction revision `codex-memo-remote-mcp-00011-sev`でresolveが
`302`になり、Host Appで画像を表示できた。再デプロイ、Secret変更、
API contract変更は行っていない。

## Preflight

```sh
cd /Users/hideki/Documents/develop/codex-tools

test -z "$(git status --porcelain)"
TARGET_IMPLEMENTATION_REVISION="2e1bfa28313298c93bc03c4d5fc6f6c91a1314c5"
git merge-base --is-ancestor "$TARGET_IMPLEMENTATION_REVISION" HEAD
test -z "$(
  git diff "$TARGET_IMPLEMENTATION_REVISION" -- \
    Dockerfile package.json package-lock.json scripts
)"
DEPLOY_SOURCE_REVISION="$(git rev-parse HEAD)"
npm test

PROJECT_ID="hush-pointer"
REGION="us-central1"
SERVICE="codex-memo-remote-mcp"
OLD_REVISION="$(
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.latestReadyRevisionName)'
)"

ROLLBACK_DIR="$(mktemp -d)"
gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format=yaml > "$ROLLBACK_DIR/service-before.yaml"
```

`OLD_REVISION`はdeploy直前にも再取得し、固定値を盲目的に使わない。
`DEPLOY_SOURCE_REVISION`はdeploy記録へ残す。target implementation以降にruntime差分が
ある場合は、Gate Bの承認範囲を再確認する。
`ROLLBACK_DIR`はrollout完了まで保持する。

## Candidate deploy

最初はproduction trafficを移さず、tag URLだけを作る。

```sh
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --source . \
  --region "$REGION" \
  --service-account \
    "codex-memo-remote-mcp@hush-pointer.iam.gserviceaccount.com" \
  --no-invoker-iam-check \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 60 \
  --no-traffic \
  --tag gate-b-candidate
```

deploy後、candidate revisionで次が現行構成と一致することを確認する。

- service account
- Secret名とversion参照
- non-secret environment variable名と値
- min/max instances、CPU、memory、timeout
- ingressとinvoker IAM無効化

不一致があればtrafficを移さずcandidateを破棄する。

## TTL policy

codeはmemo削除後90日の日時を`expiresAt`へ保存する。Firestore側ではoffsetを追加せず、
そのtimestampをTTL fieldとして使う。

```sh
gcloud firestore fields ttls update expiresAt \
  --project "$PROJECT_ID" \
  --database='(default)' \
  --collection-group='codex-memo-sites-idempotency-v1' \
  --enable-ttl

gcloud firestore fields ttls list \
  --project "$PROJECT_ID" \
  --database='(default)' \
  --collection-group='codex-memo-sites-idempotency-v1'
```

既存memoや通常のmemo documentには`expiresAt`がないため、TTL対象にならない。
capture receiptには期限を付けない。attachment receiptだけがmemo削除後にTTL対象になる。

## Candidate smoke test

tag URLに対して次を順に確認する。

1. `GET /health`が200
2. unauthenticated `GET /sites-api/capabilities`が
   `401 UNAUTHORIZED`
3. authenticated capabilitiesが`apiVersion: "1"`とGate B featureを返す
4. authenticated `GET /sites-api/memos?limit=1`が200
5. responseとlogへcredential、attachment bytes、`storagePath`を出さない

この段階ではproduction memoを作成・更新しない。

## Traffic switch

candidate smokeと構成差分確認が成功した場合だけtrafficを移す。

```sh
CANDIDATE_REVISION="$(
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.latestReadyRevisionName)'
)"

gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions="$CANDIDATE_REVISION=100"
```

production URLでもcandidate smokeと同じread-only確認を再実行する。

rollout完了後はcandidate tagを外す。

```sh
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --remove-tags=gate-b-candidate
```

## Controlled write canary

production read-only smoke後、deploy承認にcanary writeが含まれる場合だけ実施する。

1. 一意なlowercase UUIDでdeletableなtest memoを1件作成
2. 同じpayloadを再送し、201→200、同一memo ID、`replayed: true`を確認
3. 小さいPNGを1件uploadし、同一mutationをstale expectedで再送
4. attachmentをdeleteし、同一mutationをstale expectedで再送
5. test memoを確認付きdeleteで削除
6. capture tombstoneが残り、attachment receiptへ`expiresAt`が付くことを確認

canaryのmemo本文、attachment、response bodyを通常logへ残さない。
削除後もidempotency検証用のcapture tombstone 1件は仕様どおり残る。

## Rollback

traffic移行後に問題があれば、再buildせず直前revisionへ戻す。

```sh
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions="$OLD_REVISION=100"
```

rollback後に`/health`、Remote MCP、既存Sites API read endpointを確認する。
旧revisionはcapabilitiesを公開しないため、macOS write workerはwriteを開始しない。

TTL policyは旧revisionのmemoへ影響しない。完全に戻す必要がある場合だけ次を実行する。

```sh
gcloud firestore fields ttls update expiresAt \
  --project "$PROJECT_ID" \
  --database='(default)' \
  --collection-group='codex-memo-sites-idempotency-v1' \
  --disable-ttl
```

rollbackでGate Bが作成した通常memoやreceiptを自動削除しない。削除判断は別承認にする。

## Go conditions

- ✅ target revisionの`npm test`が49件成功
- ✅ candidateのCloud Run設定が現行と一致
- ✅ TTL policyが`ACTIVE`
- ✅ candidateとproduction URLのread-only smokeが成功
- ✅ controlled write canaryの作成・retry・attachment・cleanupが成功
- ✅ rollback先`codex-memo-remote-mcp-00008-k57`と実行コマンドを保持
- ✅ macOS write workerはまだdefault-off
