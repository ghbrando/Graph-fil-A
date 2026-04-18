"""
cleanup-function — Cloud Function (2nd gen)

Trigger:  Pub/Sub push subscription on topic `graph-ready`
Purpose:
  1. Validate the pipeline completed successfully (both pipeline-service
     and summarization-service must have written to Firestore).
  2. Delete the GCS audio blob so raw audio is not retained long-term.
  3. Null-out `audioGcsPath` in the session document.
  4. Atomically increment users/{uid}/stats counters:
       totalSessions  +1
       totalNodes     +len(graph.nodes)
       totalAudioMinutes  (reserved — incremented when duration is known)

Message contract (published by pipeline-service to `graph-ready`):
  {
    "sessionId":    "abc123",
    "uid":          "firebase-uid-xyz",
    "nodeCount":    12,
    "audioGcsPath": "sessions/abc123/audio.webm"
  }
"""

import base64
import json
import logging
import os

import functions_framework
from google.cloud import firestore, storage

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Clients — initialised once at cold-start, reused across warm invocations
# ---------------------------------------------------------------------------
db = firestore.Client()
gcs = storage.Client()

AUDIO_BUCKET = os.environ["AUDIO_BUCKET_NAME"]  # e.g. "graphfila-audio-staging"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
@functions_framework.cloud_event
def handle_graph_ready(cloud_event):
    """Triggered by a Pub/Sub message on the `graph-ready` topic."""
    # --- 1. Decode Pub/Sub message ----------------------------------------
    pubsub_data = base64.b64decode(
        cloud_event.data["message"]["data"]
    ).decode("utf-8")
    msg = json.loads(pubsub_data)

    session_id = msg["sessionId"]
    uid = msg["uid"]
    node_count = int(msg.get("nodeCount", 0))
    audio_gcs_path = msg.get("audioGcsPath")  # e.g. "sessions/abc123/audio.webm"

    log.info(
        "graph-ready received | sessionId=%s uid=%s nodeCount=%d",
        session_id, uid, node_count,
    )

    # --- 2. Idempotency guard ---------------------------------------------
    # If audioGcsPath is already null the blob was deleted in a prior
    # delivery (Pub/Sub guarantees at-least-once). Safe to ack and exit.
    session_ref = db.collection("sessions").document(session_id)
    session_snap = session_ref.get()

    if not session_snap.exists:
        log.error("Session %s not found in Firestore — skipping", session_id)
        # Return 200 so Pub/Sub does not redeliver an unrecoverable message
        return

    session_data = session_snap.to_dict()

    if session_data.get("audioGcsPath") is None:
        log.info("audioGcsPath already null for %s — idempotent skip", session_id)
        return

    # --- 3. Verify pipeline completion ------------------------------------
    # Both downstream services must have written their output before we
    # clean up.  This guards against a race where summarization-service
    # publishes graph-ready before pipeline-service has finished.
    status = session_data.get("status", "")
    if status != "ready":
        log.warning(
            "Session %s status is '%s', expected 'ready' — skipping cleanup",
            session_id, status,
        )
        # Do NOT ack with 200 here; let Pub/Sub retry so we pick it up
        # once the session reaches 'ready'.  Raise to signal non-200.
        raise RuntimeError(
            f"Session {session_id} not yet ready (status={status}); "
            "will retry via Pub/Sub backoff"
        )

    # --- 4. Delete GCS audio blob ----------------------------------------
    _delete_audio_blob(audio_gcs_path, session_id)

    # --- 5. Firestore writes (batched for atomicity) ----------------------
    audio_minutes = session_data.get("audioMinutes")
    _update_firestore(session_ref, uid, node_count, audio_minutes, session_id)

    log.info("Cleanup complete for sessionId=%s", session_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _delete_audio_blob(audio_gcs_path: str, session_id: str) -> None:
    """Delete the raw audio blob from GCS. Tolerates already-deleted blobs."""
    if not audio_gcs_path:
        log.warning("No audioGcsPath on session %s — nothing to delete", session_id)
        return

    try:
        bucket = gcs.bucket(AUDIO_BUCKET)
        blob = bucket.blob(audio_gcs_path)
        blob.delete()
        log.info("Deleted GCS blob: gs://%s/%s", AUDIO_BUCKET, audio_gcs_path)
    except Exception as exc:  # noqa: BLE001
        # A 404 means the blob is already gone — treat as success.
        # Any other error is re-raised so Pub/Sub retries the delivery.
        if "404" in str(exc) or "does not exist" in str(exc).lower():
            log.warning(
                "Blob gs://%s/%s already deleted (404) — continuing",
                AUDIO_BUCKET, audio_gcs_path,
            )
        else:
            log.error("Failed to delete blob %s: %s", audio_gcs_path, exc)
            raise


def _update_firestore(
    session_ref: firestore.DocumentReference,
    uid: str,
    node_count: int,
    audio_minutes: float | int | None,
    session_id: str,
) -> None:
    """
    Atomically:
      • Null-out audioGcsPath on the session doc
      • Increment stats fields on users/{uid}

    Uses a Firestore WriteBatch so both writes succeed or both fail.
    """
    user_ref = db.collection("users").document(uid)

    batch = db.batch()

    # 5a. Clear the audio path from the session document
    batch.update(session_ref, {"audioGcsPath": None})

    # 5b. Atomic increments on the nested stats map.
    #     merge=True creates users/{uid} if it does not exist yet.
    stats_updates = {
        "totalSessions": firestore.Increment(1),
        "totalNodes": firestore.Increment(node_count),
    }
    if isinstance(audio_minutes, (int, float)) and audio_minutes >= 0:
        stats_updates["totalAudioMinutes"] = firestore.Increment(float(audio_minutes))

    batch.set(
        user_ref,
        {
            "stats": stats_updates,
        },
        merge=True,
    )

    batch.commit()
    log.info(
        "Firestore batch committed | sessionId=%s uid=%s +1session +%dnodes +%saudioMinutes",
        session_id,
        uid,
        node_count,
        audio_minutes if isinstance(audio_minutes, (int, float)) else "0",
    )
