# pipeline-service

Cloud Run service that subscribes to the `transcript-ready` Pub/Sub topic,
extracts entities and relationships with LangChain + Gemini, and writes the
knowledge graph JSON to Firestore.

## Architecture

```
transcript-ready (Pub/Sub topic)
       │
       │  push  (OIDC token, sa-pipeline-svc)
       ▼
pipeline-service  (Cloud Run, POST /pubsub/push)
       │
       ├──► Vertex AI  gemini-1.5-pro
       │       └── LangChain ChatVertexAI
       │
       └──► Firestore  sessions/{sessionId}
                └── graph, status, nodeCount, edgeCount, processedAt
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/pubsub/push` | Pub/Sub push delivery |
| `GET`  | `/health` | Cloud Run liveness/readiness probe |

## Pub/Sub message format

The transcription-service publishes a base64-encoded JSON payload:

```json
{
  "sessionId": "abc123",
  "userId": "firebase-uid",
  "transcript": "Alice: Let's discuss the Q3 budget..."
}
```

> **Fallback:** if `transcript` is omitted from the message, the service reads
> it from `sessions/{sessionId}.transcript` in Firestore. This allows the
> transcription-service to keep Pub/Sub messages small for long transcripts.

## Firestore writes

Document path: `sessions/{sessionId}`

### On receive
```json
{ "status": "processing", "updatedAt": "<timestamp>" }
```

### On success
```json
{
  "status": "ready",
  "graph": {
    "nodes": [
      { "id": "alice", "label": "Alice", "type": "person", "properties": {} }
    ],
    "edges": [
      { "id": "edge-alice-q3-budget", "source": "alice", "target": "q3-budget",
        "label": "discussed", "properties": {} }
    ]
  },
  "nodeCount": 5,
  "edgeCount": 4,
  "processedAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

### On error
```json
{ "status": "error", "errorMessage": "...", "updatedAt": "<timestamp>" }
```

## Error handling

| Error | HTTP response | Pub/Sub behaviour | Reason |
|-------|--------------|-------------------|--------|
| Bad JSON from Gemini | 200 | ACK (no retry) | Won't improve on retry |
| Invalid graph structure | 200 | ACK (no retry) | Won't improve on retry |
| Vertex AI timeout / network | 500 | NACK → retry | Transient, may succeed |

## Environment variables

Set automatically by `cloudbuild.yaml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_PROJECT` | — | GCP project ID (required) |
| `REGION` | `us-central1` | Vertex AI region |
| `GEMINI_MODEL` | `gemini-1.5-pro` | Model name |
| `PORT` | `8080` | HTTP port (set by Cloud Run) |

## Deployment

### One-time setup (run before first deploy)

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1

# 1. Deploy pipeline-service (builds image, deploys Cloud Run, sets IAM binding)
gcloud builds submit --config services/pipeline-service/cloudbuild.yaml \
  --project="$PROJECT_ID"

# 2. Wire the Pub/Sub push subscription
bash infrastructure/setup-push-subscriptions.sh
```

> **Note:** If `sa-pipeline-svc` doesn't have `roles/run.invoker` yet, run
> `bash infrastructure/iam/setup-run-invoker-bindings.sh` after deploying
> all Cloud Run services.

### Re-deploy after code changes

```bash
gcloud builds submit --config services/pipeline-service/cloudbuild.yaml \
  --project="$PROJECT_ID"
```

## Local development

```bash
cd services/pipeline-service

# Create a virtualenv and install deps
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Authenticate with GCP
gcloud auth application-default login

# Run locally
GCP_PROJECT=your-project-id python main.py
```

### Test the push endpoint locally

```bash
# Encode a test message
PAYLOAD=$(echo -n '{"sessionId":"test-session-1","userId":"uid123","transcript":"Alice and Bob met to discuss the Q3 budget. Alice will own the report. Bob is responsible for the forecast."}' | base64)

curl -X POST http://localhost:8080/pubsub/push \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"data\":\"$PAYLOAD\",\"messageId\":\"1\"}}"
```

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Python 3.11 |
| HTTP server | Flask + gunicorn (1 worker, 8 threads) |
| AI orchestration | LangChain `langchain-google-vertexai` |
| AI model | Gemini 1.5 Pro via Vertex AI |
| Database | Firestore (google-cloud-firestore) |
| Auth (push) | Pub/Sub OIDC token → Cloud Run IAM |
