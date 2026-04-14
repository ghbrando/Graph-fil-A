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

## Structure

```
infrastructure/
├── terraform/   # Terraform modules for GCP resource provisioning
└── iam/         # IAM binding definitions and service account configs
```

## Security Rules

- **No hardcoded secrets** — all credentials fetched from Secret Manager at runtime
- No default service accounts used — each component has a unique SA
- Cross-tenant access blocked at api-router (403 on uid mismatch)
