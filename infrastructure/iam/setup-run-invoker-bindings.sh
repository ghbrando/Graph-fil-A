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

service_exists() {
  gcloud run services describe "$1" \
    --region="$REGION" --project="$PROJECT_ID" \
    --format="value(metadata.name)" >/dev/null 2>&1
}

echo "==> Binding run.invoker on each Cloud Run service to sa-api-gateway"

for SERVICE in "${SERVICES[@]}"; do
  if service_exists "$SERVICE"; then
    echo "--> $SERVICE"
    gcloud run services add-iam-policy-binding "$SERVICE" \
      --region="$REGION" \
      --member="$SA_GATEWAY" \
      --role="roles/run.invoker" \
      --project="$PROJECT_ID"
  else
    echo "--> $SERVICE  (not deployed, skipping)"
  fi
done

echo "==> Done. sa-api-gateway can now invoke all deployed Cloud Run services."

# ── Pub/Sub push auth bindings ─────────────────────────────────────────────
# The Pub/Sub push subscriptions authenticate with OIDC tokens signed by the
# push-auth service account.  Cloud Run enforces run.invoker for those calls.
echo ""
echo "==> Binding run.invoker for Pub/Sub push auth service accounts"

if service_exists pipeline-service; then
  echo "--> sa-pipeline-svc → pipeline-service"
  gcloud run services add-iam-policy-binding pipeline-service \
    --region="$REGION" \
    --member="serviceAccount:sa-pipeline-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --project="$PROJECT_ID"
else
  echo "--> pipeline-service not deployed, skipping sa-pipeline-svc binding"
fi

if service_exists summarization-service; then
  echo "--> sa-summarization-svc → summarization-service"
  gcloud run services add-iam-policy-binding summarization-service \
    --region="$REGION" \
    --member="serviceAccount:sa-summarization-svc@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --project="$PROJECT_ID"
else
  echo "--> summarization-service not deployed, skipping sa-summarization-svc binding"
fi

echo "==> Done. Pub/Sub push subscriptions can now authenticate to their Cloud Run targets."
