#!/bin/bash
# infrastructure/setup-cleanup-function.sh
#
# Deploys the cleanup Cloud Function (2nd gen) and wires it to the
# `graph-ready` Pub/Sub topic via a push subscription.
#
# Prerequisites:
#   - gcloud authenticated with sufficient IAM permissions
#   - sa-cleanup-fn service account already created (setup-iam.sh)
#   - `graph-ready` Pub/Sub topic already created (setup-pubsub.sh)
#   - AUDIO_BUCKET_NAME environment variable set or edited below

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-central1}"
AUDIO_BUCKET="${AUDIO_BUCKET_NAME:?Set AUDIO_BUCKET_NAME}"

FUNCTION_NAME="cleanup-function"
SA="sa-cleanup-fn@${PROJECT_ID}.iam.gserviceaccount.com"
TOPIC="graph-ready"
SUBSCRIPTION="graph-ready-cleanup-sub"
SOURCE_DIR="functions/cleanup-function"
# ────────────────────────────────────────────────────────────────────────────

echo "==> Deploying ${FUNCTION_NAME} to ${REGION}..."

gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --region="${REGION}" \
  --runtime=python311 \
  --source="${SOURCE_DIR}" \
  --entry-point=handle_graph_ready \
  --trigger-topic="${TOPIC}" \
  --service-account="${SA}" \
  --set-env-vars="AUDIO_BUCKET_NAME=${AUDIO_BUCKET}" \
  --no-allow-unauthenticated \
  --timeout=120s \
  --memory=256Mi \
  --max-instances=10

echo "==> ${FUNCTION_NAME} deployed."

# ── Pub/Sub subscription (push) ──────────────────────────────────────────────
# Cloud Functions gen2 with --trigger-topic creates a subscription automatically.
# The block below is included for reference / if you need to recreate it manually.

# FUNCTION_URL=$(gcloud functions describe "${FUNCTION_NAME}" \
#   --region="${REGION}" \
#   --format='value(serviceConfig.uri)')
#
# gcloud pubsub subscriptions create "${SUBSCRIPTION}" \
#   --topic="${TOPIC}" \
#   --push-endpoint="${FUNCTION_URL}" \
#   --push-auth-service-account="${SA}" \
#   --ack-deadline=120 \
#   --min-retry-delay=10s \
#   --max-retry-delay=300s

# ── IAM: allow Pub/Sub to invoke the function ─────────────────────────────────
echo "==> Granting Pub/Sub invoker role to sa-cleanup-fn..."

gcloud functions add-invoker-policy-binding "${FUNCTION_NAME}" \
  --region="${REGION}" \
  --member="serviceAccount:${SA}"

# ── Firestore indexes ─────────────────────────────────────────────────────────
echo "==> Deploying Firestore indexes..."

firebase deploy \
  --only firestore:indexes \
  --project "${PROJECT_ID}"

echo "==> Firestore indexes deployment triggered (builds asynchronously)."
echo "    Monitor progress: https://console.firebase.google.com/project/${PROJECT_ID}/firestore/indexes"

echo ""
echo "✓ Cleanup function setup complete."
