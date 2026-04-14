#!/usr/bin/env bash
# setup-pubsub.sh
# Creates the Pub/Sub topics and subscriptions required by Graph-fil-A.
#
# Topics created:
#   transcript-ready  — transcription-service publishes here after transcription;
#                       pipeline-service and summarization-service subscribe (fan-out)
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

echo "==> Creating Pub/Sub topic: transcript-ready"
gcloud pubsub topics create transcript-ready \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Updating secret: transcript-ready-topic"
echo -n "transcript-ready" | gcloud secrets versions add transcript-ready-topic \
  --data-file=- \
  --project="$PROJECT_ID"

echo "==> Done. Topic 'transcript-ready' is ready."
echo ""
echo "    Next: after pipeline-service and summarization-service are deployed,"
echo "    run infrastructure/setup-push-subscriptions.sh to wire up push subscriptions."
