"""
pipeline-service — Cloud Run service
Receives transcript-ready Pub/Sub push messages, runs LangChain + Gemini to
extract entities and relationships, and writes the knowledge graph to Firestore.

Pub/Sub push endpoint: POST /pubsub/push
Health check:          GET  /health

Expected Pub/Sub message data (base64-encoded JSON):
  {
    "sessionId": "abc123",
    "uid":    "uid-xyz",
    "transcript": "full transcript text ..."
  }

Firestore writes to: sessions/{sessionId}
  - On start:   status → "processing"
  - On success: graph, status → "ready", nodeCount, edgeCount, processedAt
  - On bad JSON from model: status → "error", errorMessage (ACKs the message — won't improve on retry)
  - On transient error:     status → "error", errorMessage (NACKs — Pub/Sub will retry)
"""

import base64
import ast
import json
import logging
import os
import re
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from google.cloud import firestore
from google.cloud.pubsub_v1 import PublisherClient
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_vertexai import ChatVertexAI

# ============================================================================
# Logging
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ============================================================================
# Config (from environment — set via Cloud Run deployment)
# ============================================================================
PROJECT_ID = os.environ.get("GCP_PROJECT") or os.environ.get("PROJECT_ID", "")
REGION = os.environ.get("REGION", "us-central1")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
PORT = int(os.environ.get("PORT", 8080))

# ============================================================================
# Lazy-initialised GCP clients (reused across requests in same container)
# ============================================================================
_firestore_client: firestore.Client | None = None
_llm: ChatVertexAI | None = None
_publisher: PublisherClient | None = None


def get_firestore() -> firestore.Client:
    global _firestore_client
    if _firestore_client is None:
        logger.info("Initialising Firestore client (project=%s)", PROJECT_ID)
        _firestore_client = firestore.Client(project=PROJECT_ID or None)
    return _firestore_client


def get_llm() -> ChatVertexAI:
    global _llm
    if _llm is None:
        logger.info(
            "Initialising Vertex AI LLM (model=%s, location=%s)", GEMINI_MODEL, REGION
        )
        _llm = ChatVertexAI(
            model_name=GEMINI_MODEL,
            project=PROJECT_ID or None,
            location=REGION,
            temperature=0,        # Deterministic output for structured extraction
            max_output_tokens=8192,
        )
    return _llm


def get_publisher() -> PublisherClient:
    global _publisher
    if _publisher is None:
        logger.info("Initialising Pub/Sub publisher client")
        _publisher = PublisherClient()
    return _publisher


# ============================================================================
# System prompt — enforces { nodes: [], edges: [] } JSON output
# ============================================================================
SYSTEM_PROMPT = """\
You are an expert knowledge graph extractor. Analyse the meeting transcript and \
extract a structured knowledge graph capturing every meaningful entity and relationship.

Entity types to extract as NODES:
  person, organization, topic, decision, action, date, location, concept

Output ONLY valid JSON in exactly this format — no markdown fences, no explanation:
{
  "nodes": [
    {
      "id":    "unique-lowercase-hyphenated-slug",
      "label": "Human-Readable Display Name",
      "type":  "person|organization|topic|decision|action|date|location|concept",
      "properties": {}
    }
  ],
  "edges": [
    {
      "id":     "edge-<source-id>-<target-id>",
      "source": "<source-node-id>",
      "target": "<target-node-id>",
      "label":  "short relationship description",
      "properties": {}
    }
  ]
}

Rules:
- Node IDs must be unique lowercase slugs (e.g. "alice-smith", "q3-budget-review").
- Every edge source and target must reference an existing node ID.
- Extract at least 3 nodes and 2 edges if the transcript contains meaningful content.
- Output ONLY the JSON object — absolutely no surrounding text.\
"""


# ============================================================================
# Graph extraction
# ============================================================================

def extract_graph(transcript: str) -> dict:
    """
    Call Gemini via LangChain, parse the JSON response, and return a validated
    graph dict with "nodes" and "edges" lists.

    Raises:
        json.JSONDecodeError  — model returned non-JSON (caller ACKs message)
        ValueError            — JSON lacks required keys
        Exception             — any Vertex AI / network error (caller NACKs)
    """
    llm = get_llm()
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(
            content=(
                "Extract the knowledge graph from this meeting transcript:\n\n"
                + transcript
            )
        ),
    ]

    logger.info("Sending transcript to Gemini (%d chars)", len(transcript))
    response = llm.invoke(messages)
    raw: str = response.content.strip()

    # Strip markdown code fences in case the model ignores the instruction
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        raw = raw.strip()

    graph = json.loads(raw)  # raises JSONDecodeError if not valid JSON

    if not isinstance(graph.get("nodes"), list) or not isinstance(
        graph.get("edges"), list
    ):
        raise ValueError(
            f"Graph JSON missing 'nodes' or 'edges' arrays. Keys found: {list(graph.keys())}"
        )

    logger.info(
        "Extracted %d nodes and %d edges", len(graph["nodes"]), len(graph["edges"])
    )
    return graph


# ============================================================================
# Pub/Sub publishing
# ============================================================================

def _publish_graph_ready(
    session_id: str,
    uid: str,
    node_count: int,
    audio_gcs_path: str,
) -> None:
    """
    Publish a message to the graph-ready topic for the cleanup function.

    Message contract:
      {
        "sessionId":    "abc123",
        "uid":          "firebase-uid-xyz",
        "nodeCount":    12,
        "audioGcsPath": "sessions/abc123/audio.webm"
      }
    """
    publisher = get_publisher()
    topic_path = publisher.topic_path(PROJECT_ID, "graph-ready")

    message_json = json.dumps(
        {
            "sessionId": session_id,
            "uid": uid,
            "nodeCount": node_count,
            "audioGcsPath": audio_gcs_path,
        }
    )
    message_bytes = message_json.encode("utf-8")

    try:
        future = publisher.publish(topic_path, message_bytes)
        message_id = future.result()
        logger.info(
            "Published graph-ready message | sessionId=%s messageId=%s",
            session_id,
            message_id,
        )
        logger.info(
            "Graph-ready publish complete | sessionId=%s uid=%s nodeCount=%d audioGcsPath=%s",
            session_id,
            uid,
            node_count,
            audio_gcs_path,
        )
    except Exception as exc:
        logger.error(
            "Failed to publish graph-ready message for session %s: %s",
            session_id,
            exc,
        )
        # Log error but don't raise — the graph was already written to Firestore
        # and marked as "ready". The cleanup function will eventually retry via
        # the Pub/Sub subscription if this message failed to publish.


def _decode_pubsub_message_data(message: dict) -> dict:
    """Decode Pub/Sub message data as JSON, with a fallback for legacy dict strings."""
    raw_data = message.get("data", "")
    data_bytes = base64.b64decode(raw_data)
    decoded_text = data_bytes.decode("utf-8").strip()

    try:
        return json.loads(decoded_text)
    except json.JSONDecodeError:
        try:
            legacy_data = ast.literal_eval(decoded_text)
        except (SyntaxError, ValueError) as exc:
            logger.error("Failed to decode Pub/Sub message data: %s", exc)
            raise

        if isinstance(legacy_data, dict):
            logger.warning(
                "Pub/Sub message data was not valid JSON; accepted legacy dict payload instead"
            )
            return legacy_data

        raise ValueError("Decoded Pub/Sub message data was not a JSON object")


# ============================================================================
# Flask app
# ============================================================================
app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    """Liveness / readiness probe for Cloud Run."""
    return jsonify({"status": "ok", "service": "pipeline-service"}), 200


@app.route("/pubsub/push", methods=["POST"])
def pubsub_push():
    """
    Receive a Pub/Sub push delivery.

    Pub/Sub wraps the message in:
      { "message": { "data": "<base64>", "messageId": "...", "attributes": {} },
        "subscription": "projects/.../subscriptions/..." }

    Return 200 to ACK (do not retry), 5xx to NACK (Pub/Sub will retry).
    """
    envelope = request.get_json(silent=True)
    if not envelope or "message" not in envelope:
        logger.error("Malformed Pub/Sub envelope: %s", envelope)
        # ACK — malformed envelopes won't self-heal on retry
        return jsonify({"error": "Invalid Pub/Sub envelope"}), 400

    # ── Decode message data ──────────────────────────────────────────────────
    message = envelope["message"]
    try:
        data = _decode_pubsub_message_data(message)
    except Exception as exc:
        logger.error("Failed to decode Pub/Sub message data: %s", exc)
        return jsonify({"error": "Cannot decode message data"}), 400

    session_id: str = data.get("sessionId", "").strip()
    user_id: str = (data.get("uid") or data.get("userId") or "").strip()
    transcript: str = data.get("transcript", "").strip()

    if not session_id:
        logger.error("Message missing 'sessionId': %s", data)
        return jsonify({"error": "Missing sessionId"}), 400

    if not user_id:
        logger.error("Message missing 'uid'/'userId': %s", data)
        return jsonify({"error": "Missing uid/userId"}), 400

    # ── Fallback: read transcript from Firestore if not in message ───────────
    # Allows the transcription-service to store the transcript in Firestore
    # and publish only { sessionId, userId } to keep Pub/Sub messages small.
    if not transcript:
        logger.info(
            "No transcript in message for session %s — reading from Firestore", session_id
        )
        db = get_firestore()
        doc = db.collection("sessions").document(session_id).get()
        if not doc.exists:
            logger.error("Session %s not found in Firestore", session_id)
            # ACK — document missing won't fix itself
            return jsonify({"error": "Session document not found"}), 200
        transcript = doc.to_dict().get("transcript", "").strip()

    if not transcript:
        logger.error("Session %s has no transcript", session_id)
        return jsonify({"error": "Empty transcript"}), 200  # ACK

    logger.info(
        "Processing session %s  |  transcript: %d chars", session_id, len(transcript)
    )

    # ── Mark session as processing ───────────────────────────────────────────
    db = get_firestore()
    session_ref = db.collection("sessions").document(session_id)
    session_ref.set(
        {
            "status": "processing",
            "updatedAt": datetime.now(timezone.utc),
        },
        merge=True,
    )

    # ── Run LangChain + Gemini extraction ────────────────────────────────────
    try:
        graph = extract_graph(transcript)

        session_ref.set(
            {
                "graph": graph,
                "status": "ready",
                "nodeCount": len(graph["nodes"]),
                "edgeCount": len(graph["edges"]),
                "processedAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            },
            merge=True,
        )
        logger.info(
            "Session %s → ready  (%d nodes, %d edges)",
            session_id,
            len(graph["nodes"]),
            len(graph["edges"]),
        )

        # ── Publish graph-ready message for cleanup-function ─────────────────
        # Read the full session document to get audioGcsPath
        session_doc = session_ref.get()
        if session_doc.exists:
            session_data = session_doc.to_dict()
            audio_gcs_path = session_data.get("audioGcsPath", "")
            node_count = len(graph["nodes"])

            logger.info(
                "Publishing graph-ready message | sessionId=%s uid=%s nodeCount=%d audioGcsPath=%s",
                session_id,
                user_id,
                node_count,
                audio_gcs_path,
            )

            # Publish to graph-ready topic
            _publish_graph_ready(
                session_id=session_id,
                uid=user_id,
                node_count=node_count,
                audio_gcs_path=audio_gcs_path,
            )

        return jsonify({"status": "ok", "sessionId": session_id}), 200

    except json.JSONDecodeError as exc:
        # Model returned invalid JSON — no point retrying, ACK the message
        err_msg = f"Model returned invalid JSON: {exc}"
        logger.error("Session %s: %s", session_id, err_msg)
        session_ref.set(
            {
                "status": "error",
                "errorMessage": err_msg,
                "updatedAt": datetime.now(timezone.utc),
            },
            merge=True,
        )
        return jsonify({"status": "error", "reason": "invalid_json"}), 200

    except ValueError as exc:
        # Bad graph structure — ACK (won't improve on retry)
        err_msg = str(exc)
        logger.error("Session %s: %s", session_id, err_msg)
        session_ref.set(
            {
                "status": "error",
                "errorMessage": err_msg,
                "updatedAt": datetime.now(timezone.utc),
            },
            merge=True,
        )
        return jsonify({"status": "error", "reason": "invalid_graph_structure"}), 200

    except Exception as exc:
        # Transient error (Vertex AI timeout, network issue) — NACK so Pub/Sub retries
        err_msg = str(exc)
        logger.exception("Session %s: transient error — will NACK for retry", session_id)
        session_ref.set(
            {
                "status": "error",
                "errorMessage": err_msg,
                "updatedAt": datetime.now(timezone.utc),
            },
            merge=True,
        )
        return jsonify({"status": "error", "reason": err_msg}), 500


# ============================================================================
# Entry point (local dev — Cloud Run uses gunicorn via Dockerfile CMD)
# ============================================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=False)
