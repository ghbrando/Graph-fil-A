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

# Fetch Cloud Run service URLs
PIPELINE_URL=$(gcloud run services describe pipeline-service \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)")

SUMMARIZATION_URL=$(gcloud run services describe summarization-service \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)")

echo "==> pipeline-service URL:      $PIPELINE_URL"
echo "==> summarization-service URL: $SUMMARIZATION_URL"

echo ""
echo "==> Creating push subscription: transcript-ready-pipeline"
gcloud pubsub subscriptions create transcript-ready-pipeline \
  --topic=transcript-ready \
  --push-endpoint="${PIPELINE_URL}/pubsub/push" \
  --push-auth-service-account="sa-pipeline-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ack-deadline=300 \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Creating push subscription: transcript-ready-summarization"
gcloud pubsub subscriptions create transcript-ready-summarization \
  --topic=transcript-ready \
  --push-endpoint="${SUMMARIZATION_URL}/pubsub/push" \
  --push-auth-service-account="sa-summarization-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ack-deadline=300 \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Done. Fan-out push subscriptions are live."
