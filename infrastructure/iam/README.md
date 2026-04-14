# IAM Setup

Scripts for creating all 8 Graph-fil-A service accounts and binding least-privilege roles.
No default service accounts are used anywhere in this project.

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- GCP project created with billing enabled
- You have `roles/owner` or `roles/iam.securityAdmin` + `roles/resourcemanager.projectIamAdmin`

## Execution Order

Run the scripts in this order — later scripts depend on resources created by earlier ones.

### Step 1 — Enable APIs

```bash
export PROJECT_ID=your-gcp-project-id
bash infrastructure/iam/setup-apis.sh
```

### Step 2 — Create service accounts and project-level role bindings

```bash
bash infrastructure/iam/setup-iam.sh
```

### Step 3 — Seed Secret Manager placeholders

```bash
bash infrastructure/iam/setup-secrets.sh
```

### Step 4 — Scoped bindings (run after resources exist)

These cannot run until the named resources are deployed:

```bash
# After audio GCS bucket is created:
export AUDIO_BUCKET=your-audio-bucket-name
bash infrastructure/iam/setup-bucket-bindings.sh

# After Cloud Run services are deployed:
export REGION=us-central1
bash infrastructure/iam/setup-run-invoker-bindings.sh

# After cleanup Cloud Function is deployed:
bash infrastructure/iam/setup-scheduler-bindings.sh
```

## Service Accounts

| Service Account | Scope | Roles |
|---|---|---|
| `sa-api-gateway` | Project + per Cloud Run service | `apigateway.viewer`, `run.invoker` (resource-scoped) |
| `sa-upload-fn` | Project | `storage.objectCreator`, `secretmanager.secretAccessor` |
| `sa-transcription-svc` | Project | `storage.objectViewer`, `speech.client`, `pubsub.publisher`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-pipeline-svc` | Project | `pubsub.subscriber`, `aiplatform.user`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-summarization-svc` | Project | `pubsub.subscriber`, `aiplatform.user`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-chat-svc` | Project | `datastore.user`, `aiplatform.user`, `secretmanager.secretAccessor` |
| `sa-cleanup-fn` | Project + audio bucket | `pubsub.subscriber`, `datastore.user`, `storage.objectAdmin` (bucket-scoped) |
| `sa-scheduler` | Per Cloud Function | `cloudfunctions.invoker` (resource-scoped) |

## Scripts

| Script | When to Run |
|---|---|
| `setup-apis.sh` | First — once, after project creation |
| `setup-iam.sh` | Second — once, after APIs are enabled |
| `setup-secrets.sh` | Third — once, after project creation |
| `setup-bucket-bindings.sh` | After audio GCS bucket is created |
| `setup-run-invoker-bindings.sh` | After all Cloud Run services are deployed |
| `setup-scheduler-bindings.sh` | After cleanup Cloud Function is deployed |
