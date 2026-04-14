# Services

Five Cloud Run containerized services that form the core backend of Graph-fil-A.

| Service | Trigger | Input | Output |
|---|---|---|---|
| `api-router` | HTTP | Authenticated requests | JSON responses |
| `transcription-service` | Eventarc (GCS finalize) | Audio file path | Transcript → Pub/Sub |
| `pipeline-service` | Eventarc (Pub/Sub) | Transcript | Graph JSON → Firestore |
| `summarization-service` | Eventarc (Pub/Sub) | Transcript | Summary JSON → Firestore |
| `chat-service` | HTTP | Chat message + sessionId | AI response + highlightNodes |

Each service has its own Dockerfile, service account, and least-privilege IAM bindings.
