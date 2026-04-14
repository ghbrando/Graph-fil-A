#!/usr/bin/env bash
# setup-bucket-bindings.sh
# Binds bucket-level IAM roles for the audio bucket:
#   - sa-upload-fn: storage.objectCreator (generates signed URLs, creates objects)
#   - sa-cleanup-fn: storage.objectAdmin (deletes objects post-processing)
#
# Run this AFTER the audio GCS bucket has been created.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export AUDIO_BUCKET=your-audio-bucket-name
#   bash infrastructure/iam/setup-bucket-bindings.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
AUDIO_BUCKET="${AUDIO_BUCKET:?ERROR: Set AUDIO_BUCKET before running this script}"

# Strip gs:// prefix if provided
AUDIO_BUCKET="${AUDIO_BUCKET#gs://}"

SA_UPLOAD="serviceAccount:sa-upload-fn@${PROJECT_ID}.iam.gserviceaccount.com"
SA_CLEANUP="serviceAccount:sa-cleanup-fn@${PROJECT_ID}.iam.gserviceaccount.com"

# ---------------------------------------------------------------------------
# Bind sa-upload-fn: storage.objectCreator
# Allows generation of signed URLs and creation of new objects
# ---------------------------------------------------------------------------
echo "==> Binding storage.objectCreator on bucket [$AUDIO_BUCKET] to sa-upload-fn"
gsutil iam ch "${SA_UPLOAD}:roles/storage.objectCreator" "gs://${AUDIO_BUCKET}"
echo "    ✓ sa-upload-fn can now create signed URLs and upload objects"

# ---------------------------------------------------------------------------
# Bind sa-cleanup-fn: storage.objectAdmin
# Allows deletion of objects post-processing
# ---------------------------------------------------------------------------
echo "==> Binding storage.objectAdmin on bucket [$AUDIO_BUCKET] to sa-cleanup-fn"
gsutil iam ch "${SA_CLEANUP}:roles/storage.objectAdmin" "gs://${AUDIO_BUCKET}"
echo "    ✓ sa-cleanup-fn can now delete objects"

echo ""
echo "==> Done. Bucket-level IAM bindings configured for gs://${AUDIO_BUCKET}"
