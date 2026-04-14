#!/usr/bin/env bash
# setup-scheduler-bindings.sh
# Binds cloudfunctions.invoker to sa-scheduler scoped to the cleanup function.
# Run this AFTER the cleanup Cloud Function is deployed.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export REGION=us-central1
#   bash infrastructure/iam/setup-scheduler-bindings.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
REGION="${REGION:-us-central1}"

SA_SCHEDULER="serviceAccount:sa-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
CLEANUP_FUNCTION="cleanup-function"

echo "==> Binding cloudfunctions.invoker on [$CLEANUP_FUNCTION] to sa-scheduler"

gcloud functions add-iam-policy-binding "$CLEANUP_FUNCTION" \
  --region="$REGION" \
  --member="$SA_SCHEDULER" \
  --role="roles/cloudfunctions.invoker" \
  --project="$PROJECT_ID"

echo "==> Done. sa-scheduler can now invoke $CLEANUP_FUNCTION only."
