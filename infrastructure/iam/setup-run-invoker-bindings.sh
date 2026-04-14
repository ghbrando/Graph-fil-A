#!/usr/bin/env bash
# setup-run-invoker-bindings.sh
# Binds run.invoker to sa-api-gateway scoped per Cloud Run service.
# Run this AFTER all Cloud Run services are deployed.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export REGION=us-central1   # or whichever region you deployed to
#   bash infrastructure/iam/setup-run-invoker-bindings.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
REGION="${REGION:-us-central1}"

SA_GATEWAY="serviceAccount:sa-api-gateway@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Run services that api-gateway is allowed to invoke
SERVICES=(
  "api-router"
  "transcription-service"
  "pipeline-service"
  "summarization-service"
  "chat-service"
)

echo "==> Binding run.invoker on each Cloud Run service to sa-api-gateway"

for SERVICE in "${SERVICES[@]}"; do
  echo "--> $SERVICE"
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --region="$REGION" \
    --member="$SA_GATEWAY" \
    --role="roles/run.invoker" \
    --project="$PROJECT_ID"
done

echo "==> Done. sa-api-gateway can now invoke all Cloud Run services."
