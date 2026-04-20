"""
orphan-cleanup — Cloud Function (2nd gen)

Trigger:  HTTP (POST) — invoked nightly by Cloud Scheduler via sa-scheduler
Purpose:
  Scan the GCS audio bucket for blobs that were never successfully processed
  and delete them to prevent runaway storage costs.

Deletion criteria (blob must meet ALL that apply):
  • Object is older than ORPHAN_AGE_HOURS (default 24 h)
  • AND one of:
      a) No matching Firestore session document exists, OR
      b) Session exists but status is still 'uploading' or 'transcribing'
         (i.e. the pipeline stalled before completing)

Security:
  • Function requires Bearer token issued to sa-scheduler.
  • sa-scheduler has only roles/cloudfunctions.invoker on this function.
  • No credentials are hardcoded anywhere.
"""

import logging
import os
from datetime import datetime, timezone, timedelta

import functions_framework
from google.cloud import firestore, storage
from flask import Request, jsonify

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Clients — initialised once at cold-start
# ---------------------------------------------------------------------------
db = firestore.Client()
gcs = storage.Client()

AUDIO_BUCKET = os.environ["AUDIO_BUCKET_NAME"]          # e.g. "graphfila-audio-staging"
ORPHAN_AGE_HOURS = int(os.environ.get("ORPHAN_AGE_HOURS", "24"))

# Session statuses that indicate a stalled / incomplete pipeline
STALE_STATUSES = {"uploading", "transcribing"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
@functions_framework.http
def handle_orphan_cleanup(request: Request):
    """
    HTTP trigger — called nightly by Cloud Scheduler.

    Cloud Scheduler sends a POST with an OIDC token; Cloud Functions 2nd gen
    validates the token automatically when the function requires authentication.

    Returns a JSON summary suitable for Cloud Logging / alerting.
    """
    log.info(
        "orphan-cleanup started | bucket=%s age_threshold=%dh",
        AUDIO_BUCKET, ORPHAN_AGE_HOURS,
    )

    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=ORPHAN_AGE_HOURS)

    bucket = gcs.bucket(AUDIO_BUCKET)
    blobs = list(bucket.list_blobs())  # list once; blobs carry metadata

    stats = {
        "blobs_scanned": 0,
        "blobs_skipped_recent": 0,
        "blobs_deleted_no_session": 0,
        "blobs_deleted_stale_status": 0,
        "blobs_retained": 0,
        "errors": 0,
    }

    for blob in blobs:
        stats["blobs_scanned"] += 1
        blob_age_desc = f"gs://{AUDIO_BUCKET}/{blob.name}"

        # ------------------------------------------------------------------
        # 1. Age gate — skip anything younger than the threshold
        # ------------------------------------------------------------------
        if blob.time_created is None or blob.time_created >= cutoff_time:
            stats["blobs_skipped_recent"] += 1
            log.debug("Skipping recent blob: %s", blob_age_desc)
            continue

        # ------------------------------------------------------------------
        # 2. Derive the session ID from the blob path
        #    Convention: sessions/{sessionId}/audio.<ext>
        # ------------------------------------------------------------------
        session_id = _extract_session_id(blob.name)
        if session_id is None:
            log.warning(
                "Cannot parse sessionId from blob path '%s' — skipping",
                blob.name,
            )
            stats["blobs_retained"] += 1
            continue

        # ------------------------------------------------------------------
        # 3. Cross-reference Firestore
        # ------------------------------------------------------------------
        try:
            should_delete, reason = _evaluate_blob(session_id, blob_age_desc)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "Firestore lookup failed for blob %s: %s", blob_age_desc, exc
            )
            stats["errors"] += 1
            continue

        if not should_delete:
            stats["blobs_retained"] += 1
            continue

        # ------------------------------------------------------------------
        # 4. Delete the orphaned blob
        # ------------------------------------------------------------------
        try:
            blob.delete()
            log.info(
                "Deleted orphaned blob: %s | reason=%s", blob_age_desc, reason
            )
            if reason == "no_session":
                stats["blobs_deleted_no_session"] += 1
            else:
                stats["blobs_deleted_stale_status"] += 1
        except Exception as exc:  # noqa: BLE001
            if "404" in str(exc) or "does not exist" in str(exc).lower():
                log.warning("Blob already gone (404): %s", blob_age_desc)
                # Count as deleted — another instance beat us to it
                stats["blobs_deleted_no_session"] += 1
            else:
                log.error("Failed to delete blob %s: %s", blob_age_desc, exc)
                stats["errors"] += 1

    log.info("orphan-cleanup finished | stats=%s", stats)
    return jsonify({"status": "ok", "stats": stats}), 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_session_id(blob_name: str) -> str | None:
    """
    Extract the session ID from a GCS blob path.

    Expected format:  sessions/{sessionId}/audio.<ext>
    Returns None if the path does not match the convention.
    """
    parts = blob_name.split("/")
    # Expect: ["sessions", "<sessionId>", "audio.webm"]
    if len(parts) >= 3 and parts[0] == "sessions":
        return parts[1]
    return None


def _evaluate_blob(session_id: str, blob_desc: str) -> tuple[bool, str]:
    """
    Decide whether a blob should be deleted.

    Returns (should_delete: bool, reason: str) where reason is one of:
      • "no_session"     — no Firestore document found
      • "stale_status"   — document exists but pipeline stalled
      • "healthy"        — document is fine; keep the blob
    """
    session_ref = db.collection("sessions").document(session_id)
    snap = session_ref.get()

    if not snap.exists:
        log.info(
            "No Firestore session for blob %s (sessionId=%s) — marking for deletion",
            blob_desc, session_id,
        )
        return True, "no_session"

    session_data = snap.to_dict()
    status = session_data.get("status", "")

    if status in STALE_STATUSES:
        log.info(
            "Session %s stalled at status='%s' for blob %s — marking for deletion",
            session_id, status, blob_desc,
        )
        return True, "stale_status"

    # Session exists and is in a terminal / healthy state — keep the blob
    # (e.g. status == "ready" with audioGcsPath not yet null-ed, which can
    # happen transiently before the event-driven cleanup function runs)
    return False, "healthy"
