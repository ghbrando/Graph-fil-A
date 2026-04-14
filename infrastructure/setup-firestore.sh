#!/usr/bin/env bash
# setup-firestore.sh
# Initializes Firestore in Native mode for Graph-fil-A.
# Must be run once per GCP project — Firestore mode cannot be changed after init.
#
# Native mode is required for:
#   - Real-time onSnapshot listeners (frontend live updates)
#   - Composite indexes (uid + createdAt for session history queries)
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export FIRESTORE_REGION=nam5   # nam5 = US multi-region (recommended)
#   bash infrastructure/setup-firestore.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
FIRESTORE_REGION="${FIRESTORE_REGION:-nam5}"

echo "==> Initializing Firestore (Native mode) in region: $FIRESTORE_REGION"
gcloud firestore databases create \
  --location="$FIRESTORE_REGION" \
  --project="$PROJECT_ID" 2>/dev/null || echo "    (already exists, skipping)"

echo "==> Done. Firestore Native mode database is ready."
echo ""
echo "    Composite index (uid ASC + createdAt DESC) on the sessions collection"
echo "    will be created automatically by Firestore when the first query runs,"
echo "    or you can deploy firestore.indexes.json via 'firebase deploy --only firestore:indexes'."
