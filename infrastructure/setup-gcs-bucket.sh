#!/usr/bin/env bash
# setup-gcs-bucket.sh
# Creates the GCS bucket for audio file staging.
# Audio files are temporary (deleted after processing) but stored in STANDARD class
# for immediate availability to transcription services.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - PROJECT_ID set (your GCP project)
#   - Billing enabled on the project
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export BUCKET_LOCATION=us-central1  # Optional; defaults to US
#   bash infrastructure/setup-gcs-bucket.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"
BUCKET_LOCATION="${BUCKET_LOCATION:-US}"
BUCKET_NAME="${PROJECT_ID}-audio"

echo "==> Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# ---------------------------------------------------------------------------
# Create audio bucket (idempotent)
# ---------------------------------------------------------------------------
echo "==> Creating GCS bucket [$BUCKET_NAME]"

if gsutil ls "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "    (bucket already exists, skipping creation)"
else
  gsutil mb \
    -p "$PROJECT_ID" \
    -l "$BUCKET_LOCATION" \
    -b on \
    "gs://${BUCKET_NAME}"
  echo "    ✓ Bucket created"
fi

# ---------------------------------------------------------------------------
# Set lifecycle policy: delete objects after 48h (temp audio files)
# ---------------------------------------------------------------------------
echo "==> Setting lifecycle policy (delete after 48h)"

cat > /tmp/lifecycle.json <<'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 2}
      }
    ]
  }
}
EOF

gsutil lifecycle set /tmp/lifecycle.json "gs://${BUCKET_NAME}"
rm /tmp/lifecycle.json
echo "    ✓ Lifecycle policy set"

# ---------------------------------------------------------------------------
# Disable versioning (not needed for temporary audio files)
# ---------------------------------------------------------------------------
echo "==> Disabling versioning"
gsutil versioning set off "gs://${BUCKET_NAME}"
echo "    ✓ Versioning disabled"

# ---------------------------------------------------------------------------
# CORS: allow browser PUT uploads via signed URLs
# ---------------------------------------------------------------------------
echo "==> Setting CORS policy (browser uploads via signed URL)"

cat > /tmp/cors.json <<'EOF'
[
  {
    "origin": ["http://localhost:5173", "http://127.0.0.1:5173"],
    "method": ["PUT", "GET", "HEAD", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
EOF

gsutil cors set /tmp/cors.json "gs://${BUCKET_NAME}"
rm /tmp/cors.json
echo "    ✓ CORS policy set"

echo ""
echo "==> Audio bucket ready: gs://${BUCKET_NAME}"
echo ""
echo "    Next step:"
echo "    export AUDIO_BUCKET=$BUCKET_NAME"
echo "    bash infrastructure/iam/setup-bucket-bindings.sh"
