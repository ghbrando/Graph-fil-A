#!/usr/bin/env bash
# =============================================================================
# deploy_orphan_cleanup.sh
#
# One-shot deployment of the nightly orphan-cleanup infrastructure.
# Idempotent: safe to re-run after config changes.
#
# Usage:
#   export PROJECT_ID=my-gcp-project
#   export AUDIO_BUCKET_NAME=graphfila-audio-staging
#   export REGION=us-central1          # optional, defaults below
#   export ORPHAN_AGE_HOURS=24         # optional
#   ./deploy_orphan_cleanup.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config — override via env vars
# ---------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
AUDIO_BUCKET_NAME="${AUDIO_BUCKET_NAME:?Set AUDIO_BUCKET_NAME}"
REGION="${REGION:-us-central1}"
ORPHAN_AGE_HOURS="${ORPHAN_AGE_HOURS:-24}"

FUNCTION_NAME="orphan-cleanup"
SCHEDULER_JOB_NAME="nightly-orphan-cleanup"
SA_NAME="sa-scheduler"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SOURCE_DIR="$(dirname "$0")/../functions/orphan-cleanup"

echo "==> Project:      ${PROJECT_ID}"
echo "==> Region:       ${REGION}"
echo "==> Audio bucket: ${AUDIO_BUCKET_NAME}"
echo "==> Age threshold: ${ORPHAN_AGE_HOURS}h"
echo ""

# ---------------------------------------------------------------------------
# 1. Service account
# ---------------------------------------------------------------------------
echo "--- Creating service account ${SA_NAME} (idempotent) ---"
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="Cloud Scheduler — nightly cleanup invoker" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "    (already exists — skipping)"

# ---------------------------------------------------------------------------
# 2. Deploy Cloud Function (2nd gen)
# ---------------------------------------------------------------------------
echo "--- Deploying Cloud Function ${FUNCTION_NAME} ---"
gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --runtime=python312 \
  --source="${SOURCE_DIR}" \
  --entry-point=handle_orphan_cleanup \
  --trigger-http \
  --no-allow-unauthenticated \
  --memory=256MB \
  --timeout=540s \
  --max-instances=1 \
  --set-env-vars="AUDIO_BUCKET_NAME=${AUDIO_BUCKET_NAME},ORPHAN_AGE_HOURS=${ORPHAN_AGE_HOURS}" \
  --ingress-settings=internal-and-gclb

# Capture the function's HTTPS URI (needed for IAM and Scheduler)
FUNCTION_URI=$(gcloud functions describe "${FUNCTION_NAME}" \
  --gen2 \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(serviceConfig.uri)")

echo "    Function URI: ${FUNCTION_URI}"

# ---------------------------------------------------------------------------
# 3. IAM — sa-scheduler gets invoker on this function only
#    Cloud Functions 2nd gen is backed by Cloud Run, so the role is
#    roles/run.invoker on the underlying Cloud Run service.
# ---------------------------------------------------------------------------
echo "--- Granting roles/run.invoker to ${SA_EMAIL} ---"
gcloud run services add-iam-policy-binding "${FUNCTION_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker"

# ---------------------------------------------------------------------------
# 4. Cloud Scheduler job
# ---------------------------------------------------------------------------
echo "--- Creating/updating Cloud Scheduler job ${SCHEDULER_JOB_NAME} ---"

# `create` fails if the job already exists; `update` fails if it does not.
# Try update first; fall back to create.
if gcloud scheduler jobs describe "${SCHEDULER_JOB_NAME}" \
      --location="${REGION}" \
      --project="${PROJECT_ID}" &>/dev/null; then
  SCHEDULER_CMD="update http"
else
  SCHEDULER_CMD="create http"
fi

gcloud scheduler jobs ${SCHEDULER_CMD} "${SCHEDULER_JOB_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --schedule="0 2 * * *" \
  --time-zone="UTC" \
  --uri="${FUNCTION_URI}" \
  --http-method=POST \
  --oidc-service-account-email="${SA_EMAIL}" \
  --oidc-token-audience="${FUNCTION_URI}" \
  --attempt-deadline=600s \
  --max-retry-attempts=3 \
  --min-backoff=60s \
  --max-backoff=600s \
  --max-doublings=3 \
  --description="Invoke orphan-cleanup Cloud Function to purge stale GCS audio blobs"

echo ""
echo "==> Done."
echo "    Function:  ${FUNCTION_URI}"
echo "    Scheduler: ${SCHEDULER_JOB_NAME} (0 2 * * * UTC)"
echo "    SA:        ${SA_EMAIL}  →  roles/run.invoker (scoped to ${FUNCTION_NAME})"
