#!/usr/bin/env bash
# setup-pubsub.sh
# Creates the Pub/Sub topics and subscriptions required by Graph-fil-A.
#
# Topics created:
#   transcript-ready  — transcription-service publishes here after transcription;
#                       pipeline-service and summarization-service subscribe (fan-out)
#   graph-ready       — pipeline-service publishes here after graph build;
#                       cleanup-function subscribes via push subscription
#
# Note: push subscriptions for pipeline-service and summarization-service are
# created in setup-push-subscriptions.sh AFTER those Cloud Run services are deployed
# (their URLs are required).
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   bash infrastructure/setup-pubsub.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"

ensure_secret_exists() {
  local secret_name="$1"
  gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud secrets create "$secret_name" \
      --replication-policy="automatic" \
      --project="$PROJECT_ID" >/dev/null
}

echo "==> Creating Pub/Sub topic: transcript-ready"
gcloud pubsub topics create transcript-ready \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Creating Pub/Sub topic: graph-ready"
gcloud pubsub topics create graph-ready \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Updating secret: transcript-ready-topic"
ensure_secret_exists "transcript-ready-topic"
echo -n "transcript-ready" | gcloud secrets versions add transcript-ready-topic \
  --data-file=- \
  --project="$PROJECT_ID"

echo "==> Updating secret: graph-ready-topic"
ensure_secret_exists "graph-ready-topic"
echo -n "graph-ready" | gcloud secrets versions add graph-ready-topic \
  --data-file=- \
  --project="$PROJECT_ID"

echo "==> Done. Topics 'transcript-ready' and 'graph-ready' are ready."
echo ""
echo "    Next: after pipeline-service, summarization-service, and cleanup-function are deployed,"
echo "    run infrastructure/setup-push-subscriptions.sh to wire up push subscriptions."
