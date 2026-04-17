"""
pipeline-service — Cloud Run service
Receives transcript-ready Pub/Sub push messages, runs LangChain + Gemini to
extract entities and relationships, and writes the knowledge graph to Firestore.

Pub/Sub push endpoint: POST /pubsub/push
Health check:          GET  /health

Expected Pub/Sub message data (base64-encoded JSON):
  {
    "sessionId": "abc123",
    "userId":    "uid-xyz",
    "transcript": "full transcript text ..."
  }

Firestore writes to: sessions/{sessionId}
  - On start:   status → "processing"
  - On success: graph, status → "ready", nodeCount, edgeCount, processedAt
  - On bad JSON from model: status → "error", errorMessage (ACKs the message — won't improve on retry)
  - On transient error:     status → "error", errorMessage (NACKs — Pub/Sub will retry)
"""

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from google.cloud import firestore
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
        data_bytes = base64.b64decode(message.get("data", ""))
        data: dict = json.loads(data_bytes.decode("utf-8"))
    except Exception as exc:
        logger.error("Failed to decode Pub/Sub message data: %s", exc)
        return jsonify({"error": "Cannot decode message data"}), 400

    session_id: str = data.get("sessionId", "").strip()
    transcript: str = data.get("transcript", "").strip()

    if not session_id:
        logger.error("Message missing 'sessionId': %s", data)
        return jsonify({"error": "Missing sessionId"}), 400

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
