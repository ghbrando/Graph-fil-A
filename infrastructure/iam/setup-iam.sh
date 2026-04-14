#!/usr/bin/env bash
# setup-iam.sh
# Creates all 8 Graph-fil-A service accounts and binds project-level IAM roles.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Billing enabled on the project
#   - Run once after GCP project creation
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   bash infrastructure/iam/setup-iam.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Config — set PROJECT_ID before running
# ---------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"

echo "==> Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# ---------------------------------------------------------------------------
# Helper: create a service account (idempotent)
# ---------------------------------------------------------------------------
create_sa() {
  local name="$1"
  local display="$2"
  echo "--> Creating SA: $name"
  gcloud iam service-accounts create "$name" \
    --display-name="$display" \
    --project="$PROJECT_ID" || echo "    (already exists, skipping)"
}

# ---------------------------------------------------------------------------
# Helper: bind a project-level role to a service account
# ---------------------------------------------------------------------------
bind_role() {
  local sa="$1"
  local role="$2"
  echo "    binding $role -> $sa"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" \
    --condition=None \
    --quiet
}

# ===========================================================================
# 1. sa-api-gateway
#    Entry point; validates JWTs and routes to Cloud Run services.
#    run.invoker is bound at the resource level per service (see NOTE below).
# ===========================================================================
create_sa "sa-api-gateway" "API Gateway"
bind_role "sa-api-gateway" "roles/apigateway.viewer"
# NOTE: roles/run.invoker must be bound per Cloud Run service (resource-level),
#       not at the project level. Run setup-run-invoker-bindings.sh after
#       Cloud Run services are deployed.

# ===========================================================================
# 2. sa-upload-fn
#    Generates signed GCS upload URLs for browser-direct uploads.
# ===========================================================================
create_sa "sa-upload-fn" "Upload Signed URL Function"
bind_role "sa-upload-fn" "roles/storage.objectCreator"
bind_role "sa-upload-fn" "roles/secretmanager.secretAccessor"

# ===========================================================================
# 3. sa-transcription-svc
#    Reads audio from GCS, transcribes via Speech-to-Text, publishes to Pub/Sub.
# ===========================================================================
create_sa "sa-transcription-svc" "Transcription Cloud Run Service"
bind_role "sa-transcription-svc" "roles/storage.objectViewer"
bind_role "sa-transcription-svc" "roles/speech.client"
bind_role "sa-transcription-svc" "roles/pubsub.publisher"
bind_role "sa-transcription-svc" "roles/datastore.user"
bind_role "sa-transcription-svc" "roles/secretmanager.secretAccessor"

# ===========================================================================
# 4. sa-pipeline-svc
#    Subscribes to transcript-ready topic; extracts entities/relationships
#    via LangChain + Gemini; writes graph JSON to Firestore.
# ===========================================================================
create_sa "sa-pipeline-svc" "Pipeline Cloud Run Service"
bind_role "sa-pipeline-svc" "roles/pubsub.subscriber"
bind_role "sa-pipeline-svc" "roles/aiplatform.user"
bind_role "sa-pipeline-svc" "roles/datastore.user"
bind_role "sa-pipeline-svc" "roles/secretmanager.secretAccessor"

# ===========================================================================
# 5. sa-summarization-svc
#    Subscribes to transcript-ready topic (fan-out); generates synopsis,
#    action items, and key decisions via Gemini.
# ===========================================================================
create_sa "sa-summarization-svc" "Summarization Cloud Run Service"
bind_role "sa-summarization-svc" "roles/pubsub.subscriber"
bind_role "sa-summarization-svc" "roles/aiplatform.user"
bind_role "sa-summarization-svc" "roles/datastore.user"
bind_role "sa-summarization-svc" "roles/secretmanager.secretAccessor"

# ===========================================================================
# 6. sa-chat-svc
#    Handles multi-turn conversational chat; highlights nodes in responses.
# ===========================================================================
create_sa "sa-chat-svc" "Chat Cloud Run Service"
bind_role "sa-chat-svc" "roles/datastore.user"
bind_role "sa-chat-svc" "roles/aiplatform.user"
bind_role "sa-chat-svc" "roles/secretmanager.secretAccessor"

# ===========================================================================
# 7. sa-cleanup-fn
#    Deletes GCS audio blobs post-processing; runs nightly orphan cleanup.
#    storage.objectAdmin is bound at the bucket level (see NOTE below).
# ===========================================================================
create_sa "sa-cleanup-fn" "Cleanup Cloud Function"
bind_role "sa-cleanup-fn" "roles/pubsub.subscriber"
bind_role "sa-cleanup-fn" "roles/datastore.user"
# NOTE: roles/storage.objectAdmin must be scoped to the audio bucket only,
#       not the whole project. Run setup-bucket-bindings.sh after the
#       audio bucket is created.

# ===========================================================================
# 8. sa-scheduler
#    Triggers the nightly cleanup Cloud Function via Cloud Scheduler.
#    cloudfunctions.invoker is bound at the function level (see NOTE below).
# ===========================================================================
create_sa "sa-scheduler" "Cloud Scheduler"
# NOTE: roles/cloudfunctions.invoker must be bound per Cloud Function
#       (resource-level). Run setup-scheduler-bindings.sh after the
#       cleanup function is deployed.

echo ""
echo "==> All service accounts created and project-level roles bound."
echo ""
echo "    Next steps:"
echo "    1. Create the audio GCS bucket, then run setup-bucket-bindings.sh"
echo "    2. Deploy Cloud Run services, then run setup-run-invoker-bindings.sh"
echo "    3. Deploy Cloud Functions, then run setup-scheduler-bindings.sh"
echo "    4. Run setup-secrets.sh to enable Secret Manager and seed placeholders"
