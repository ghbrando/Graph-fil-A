# Graph-fil-A

**Voice-to-knowledge graph web application** — transforms spoken audio into interactive, navigable knowledge graphs using a fully GCP-native, cloud-first architecture.

## Architecture Overview

The system follows a strict **Ingest → Process → Store → Output** lifecycle:

1. **Ingest** — User authenticates via Firebase Auth; browser captures audio and uploads directly to GCS via signed URL
2. **Process** — Eventarc triggers fan out to transcription, pipeline (entity extraction), and summarization services via Pub/Sub
3. **Store** — Firestore persists session documents; GCS audio blobs deleted after processing
4. **Output** — React frontend renders an interactive Cytoscape.js mind map with real-time Firestore updates and AI chat

## Repository Structure

```
Graph-fil-A/
├── docs/                        # Project documentation and PRD
├── containers/                  # Shared Cloud Build config
├── services/                    # Cloud Run containerized services
│   ├── api-router/              # API Gateway entry point, JWT validation
│   ├── transcription-service/   # Audio → text via Speech-to-Text
│   ├── pipeline-service/        # LangChain + Gemini entity/relationship extraction
│   ├── summarization-service/   # Gemini-powered synopsis, action items, key decisions
│   └── chat-service/            # Multi-turn chat with node highlighting
├── functions/                   # Cloud Functions (lightweight connectors)
│   ├── signed-url-function/     # Generates signed GCS upload URLs
│   └── cleanup-function/        # Deletes GCS audio blobs post-processing
├── frontend/                    # React app (Cytoscape.js, Firebase Auth)
│   ├── src/
│   │   ├── components/          # UI components (MindMap, ChatPanel, etc.)
│   │   └── services/            # API, Firestore, and Auth helpers
│   └── public/
└── infrastructure/              # IAM bindings, Terraform, Secret Manager configs
    ├── terraform/
    └── iam/
```

## GCP Services

| Service | Role |
|---|---|
| API Gateway | Single entry point; Firebase JWT + API Key validation |
| Firebase Auth | User identity and JWT issuance |
| Cloud Storage | Temporary audio staging |
| Eventarc | Event-driven triggers (GCS finalize, Pub/Sub) |
| Pub/Sub | Fan-out pattern: one transcript → two parallel services |
| Cloud Run | Five containerized services |
| Cloud Functions | Signed URL generator, cleanup |
| Speech-to-Text | AI Task 1 — audio transcription |
| Vertex AI / Gemini | AI Tasks 2 & 3 — extraction, summarization, chat |
| Firestore | Session persistence and real-time updates |
| Secret Manager | All credentials (no hardcoded secrets) |
| Cloud Scheduler | Nightly cleanup job |

## Sprint Timeline

| Dates | Milestone |
|---|---|
| Apr 13–14 | Kickoff |
| Apr 15–16 | Auth + infrastructure |
| Apr 17–18 | Pipeline core (Update 2 demo) |
| Apr 19 | Sprint 1 demo |
| Apr 20–21 | Basic UI |
| Apr 22–23 | Chat + node highlighting |
| Apr 24 | Polish + cleanup |
| Apr 25 | Final demo video |
| Apr 26 | **Submission due** |

## Security

- All credentials stored in Secret Manager — no hardcoded strings, env vars, or config files
- Firebase JWT validation on every route
- Unique service accounts per component (8 total, least-privilege)
- Cross-tenant isolation enforced (403 on ownership mismatch)
