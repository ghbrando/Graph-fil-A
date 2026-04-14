#!/usr/bin/env bash
# setup-secrets.sh
# Enables Secret Manager and seeds placeholder secrets for all services.
# Replace PLACEHOLDER values before deploying any service.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   bash infrastructure/iam/setup-secrets.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"

echo "==> Enabling Secret Manager API"
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

# ---------------------------------------------------------------------------
# Helper: create a secret with a placeholder value (idempotent)
# ---------------------------------------------------------------------------
create_secret() {
  local name="$1"
  local placeholder="${2:-PLACEHOLDER}"
  echo "--> $name"
  # Create the secret resource
  gcloud secrets create "$name" \
    --replication-policy="automatic" \
    --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping create)"
  # Add a version with the placeholder value
  echo -n "$placeholder" | gcloud secrets versions add "$name" \
    --data-file=- \
    --project="$PROJECT_ID"
}

echo ""
echo "==> Seeding placeholder secrets"

# Firebase
create_secret "firebase-web-api-key"
create_secret "firebase-project-id"
create_secret "firebase-admin-sdk-key"     # JSON service account key for backend

# GCS
create_secret "audio-bucket-name"

# Pub/Sub
create_secret "transcript-ready-topic"

# Vertex AI / Gemini
create_secret "vertex-ai-location"         # e.g. us-central1

# API Gateway
create_secret "api-gateway-api-key"

echo ""
echo "==> Secret Manager enabled and placeholder secrets created."
echo ""
echo "    IMPORTANT: Replace every PLACEHOLDER value before deploying."
echo "    To update a secret:"
echo "      echo -n 'real-value' | gcloud secrets versions add SECRET_NAME --data-file=- --project=$PROJECT_ID"
echo ""
echo "    To grant a service account access to a specific secret:"
echo "      gcloud secrets add-iam-policy-binding SECRET_NAME \\"
echo "        --member='serviceAccount:SA_NAME@${PROJECT_ID}.iam.gserviceaccount.com' \\"
echo "        --role='roles/secretmanager.secretAccessor' \\"
echo "        --project=$PROJECT_ID"
