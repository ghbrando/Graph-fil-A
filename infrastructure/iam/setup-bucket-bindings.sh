#!/usr/bin/env bash
# setup-bucket-bindings.sh
# Binds storage.objectAdmin to sa-cleanup-fn scoped to the audio bucket only.
# Run this AFTER the audio GCS bucket has been created.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export AUDIO_BUCKET=your-audio-bucket-name
#   bash infrastructure/iam/setup-bucket-bindings.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
AUDIO_BUCKET="${AUDIO_BUCKET:?ERROR: Set AUDIO_BUCKET before running this script}"

SA_CLEANUP="serviceAccount:sa-cleanup-fn@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Binding storage.objectAdmin on bucket [$AUDIO_BUCKET] to sa-cleanup-fn"

gsutil iam ch "${SA_CLEANUP}:roles/storage.objectAdmin" "gs://${AUDIO_BUCKET}"

echo "==> Done. sa-cleanup-fn can now delete objects in gs://${AUDIO_BUCKET} only."
