#!/usr/bin/env bash
# setup-functions-invoker-bindings.sh
# Binds cloudfunctions.invoker to sa-api-gateway scoped per Cloud Function.
# Run this AFTER all Cloud Functions are deployed.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export REGION=us-central1   # or whichever region you deployed to
#   bash infrastructure/iam/setup-functions-invoker-bindings.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
REGION="${REGION:-us-central1}"

SA_GATEWAY="serviceAccount:sa-api-gateway@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Functions that api-gateway is allowed to invoke
FUNCTIONS=(
  "sa-upload-fn"
)

echo "==> Binding run.invoker on Cloud Run services (underlying gen2 functions) to sa-api-gateway"

for FUNCTION in "${FUNCTIONS[@]}"; do
  echo "--> $FUNCTION"
  gcloud run services add-iam-policy-binding "$FUNCTION" \
    --region="$REGION" \
    --member="$SA_GATEWAY" \
    --role="roles/run.invoker" \
    --project="$PROJECT_ID"
done

echo "==> Done. sa-api-gateway can now invoke all gen2 Cloud Functions."
