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
| `iam/setup-apis.sh` | 1️⃣ First — enable all GCP APIs |
| `iam/setup-iam.sh` | 2️⃣ Second — create service accounts + project-level role bindings |
| `setup-gcs-bucket.sh` | 3️⃣ Third — create audio GCS bucket with lifecycle policy |
| `iam/setup-bucket-bindings.sh` | 4️⃣ Fourth — bind bucket-level IAM (sa-upload-fn, sa-cleanup-fn) |
| `iam/setup-secrets.sh` | 5️⃣ Fifth — enable Secret Manager, seed placeholders |
| `setup-pubsub.sh` | 6️⃣ Sixth — create `transcript-ready` Pub/Sub topic |
| `setup-firestore.sh` | 7️⃣ Seventh — initialize Firestore in Native mode |
| `setup-push-subscriptions.sh` | After pipeline-service and summarization-service are deployed |
| `iam/setup-run-invoker-bindings.sh` | After all Cloud Run services are deployed |
| `iam/setup-scheduler-bindings.sh` | After cleanup Cloud Function is deployed |

## Structure

```
infrastructure/
├── iam/                              # Service account and role binding scripts
│   ├── setup-apis.sh                 # Enable all required GCP APIs
│   ├── setup-iam.sh                  # Create service accounts
│   ├── setup-bucket-bindings.sh      # Bind bucket-level IAM roles
│   ├── setup-run-invoker-bindings.sh # Bind Cloud Run invoker roles
│   └── setup-scheduler-bindings.sh   # Bind Cloud Scheduler invoker role
├── terraform/                        # Terraform modules (future)
├── setup-gcs-bucket.sh               # Create audio GCS bucket with lifecycle
├── setup-pubsub.sh                   # Create transcript-ready Pub/Sub topic
├── setup-firestore.sh                # Initialize Firestore Native mode
└── setup-push-subscriptions.sh       # Wire Pub/Sub push subscriptions
```

## Security Rules

- **No hardcoded secrets** — all credentials fetched from Secret Manager at runtime
- No default service accounts used — each component has a unique SA
- Cross-tenant access blocked at api-router (403 on uid mismatch)
