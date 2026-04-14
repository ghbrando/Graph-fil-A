# Functions

Lightweight Cloud Functions that act as connectors between GCP services.

| Function | Trigger | Purpose |
|---|---|---|
| `signed-url-function` | HTTP (via API Gateway) | Generates a signed GCS URL so the browser can upload audio directly to Cloud Storage |
| `cleanup-function` | Pub/Sub / Cloud Scheduler | Deletes GCS audio blobs after successful processing; also runs nightly for orphan cleanup |

Both functions use dedicated service accounts with least-privilege IAM bindings.
All credentials fetched from Secret Manager at runtime.
