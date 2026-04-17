#!/usr/bin/env bash
# setup-push-subscriptions.sh
# Creates Pub/Sub push subscriptions for pipeline-service and summarization-service.
# Run this AFTER both Cloud Run services are deployed (URLs are required).
#
# Fan-out pattern: one message on transcript-ready triggers both services in parallel.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export REGION=us-central1
#   bash infrastructure/setup-push-subscriptions.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
REGION="${REGION:-us-central1}"

# Fetch Cloud Run service URLs (skip if service not yet deployed)
PIPELINE_URL=$(gcloud run services describe pipeline-service \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || true)

SUMMARIZATION_URL=$(gcloud run services describe summarization-service \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || true)

echo "==> pipeline-service URL:      ${PIPELINE_URL:-(not deployed)}"
echo "==> summarization-service URL: ${SUMMARIZATION_URL:-(not deployed)}"

if [[ -n "$PIPELINE_URL" ]]; then
  echo ""
  echo "==> Creating push subscription: transcript-ready-pipeline"
  gcloud pubsub subscriptions create transcript-ready-pipeline \
    --topic=transcript-ready \
    --push-endpoint="${PIPELINE_URL}/pubsub/push" \
    --push-auth-service-account="sa-pipeline-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
    --ack-deadline=300 \
    --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"
else
  echo "==> Skipping transcript-ready-pipeline (pipeline-service not deployed)"
fi

if [[ -n "$SUMMARIZATION_URL" ]]; then
  echo ""
  echo "==> Creating push subscription: transcript-ready-summarization"
  gcloud pubsub subscriptions create transcript-ready-summarization \
    --topic=transcript-ready \
    --push-endpoint="${SUMMARIZATION_URL}/pubsub/push" \
    --push-auth-service-account="sa-summarization-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
    --ack-deadline=300 \
    --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"
else
  echo "==> Skipping transcript-ready-summarization (summarization-service not deployed)"
fi

echo ""
echo "==> Done."
