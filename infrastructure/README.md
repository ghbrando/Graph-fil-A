# Infrastructure

GCP infrastructure configuration — IAM bindings, Terraform definitions, and Secret Manager setup.

## Service Accounts (8 total, least-privilege)

| Service Account | Key Permissions |
|---|---|
| `sa-api-gateway` | `apigateway.viewer`, `run.invoker` (scoped) |
| `sa-upload-fn` | `storage.objectCreator`, `secretmanager.secretAccessor` |
| `sa-transcription-svc` | `storage.objectViewer`, `speech.client`, `pubsub.publisher`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-pipeline-svc` | `pubsub.subscriber`, `aiplatform.user`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-summarization-svc` | `pubsub.subscriber`, `aiplatform.user`, `datastore.user`, `secretmanager.secretAccessor` |
| `sa-chat-svc` | `datastore.user`, `aiplatform.user`, `secretmanager.secretAccessor` |
| `sa-cleanup-fn` | `storage.objectAdmin` (scoped), `pubsub.subscriber`, `datastore.user` |
| `sa-scheduler` | `cloudfunctions.invoker` (scoped) |

## Setup Scripts

Run in this order:

| Script | When |
|---|---|
| `iam/setup-apis.sh` | First — enable all GCP APIs |
| `iam/setup-iam.sh` | Second — create service accounts + project-level role bindings |
| `iam/setup-secrets.sh` | Third — enable Secret Manager, seed placeholders |
| `setup-pubsub.sh` | Fourth — create `transcript-ready` Pub/Sub topic |
| `setup-firestore.sh` | Fifth — initialize Firestore in Native mode |
| `iam/setup-bucket-bindings.sh` | After audio GCS bucket is created |
| `setup-push-subscriptions.sh` | After pipeline-service and summarization-service are deployed |
| `iam/setup-run-invoker-bindings.sh` | After all Cloud Run services are deployed |
| `iam/setup-scheduler-bindings.sh` | After cleanup Cloud Function is deployed |

## Structure

```
infrastructure/
├── iam/                          # Service account and role binding scripts
├── terraform/                    # Terraform modules (future)
├── setup-pubsub.sh               # Creates transcript-ready Pub/Sub topic
├── setup-firestore.sh            # Initializes Firestore Native mode
└── setup-push-subscriptions.sh   # Wires Pub/Sub push subscriptions to Cloud Run services
```

## Security Rules

- **No hardcoded secrets** — all credentials fetched from Secret Manager at runtime
- No default service accounts used — each component has a unique SA
- Cross-tenant access blocked at api-router (403 on uid mismatch)
