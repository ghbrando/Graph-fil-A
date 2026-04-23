"""
chat-service — Cloud Run service
Multi-turn conversational chat about a session's knowledge graph. Loads the
graph + transcript + prior history from Firestore, queries Gemini via Vertex
AI, and returns an answer plus the IDs of nodes the UI should highlight.

HTTP endpoints:
  POST /sessions/<sessionId>/chat   { "message": "..." }
  GET  /health

Firestore reads/writes: sessions/{sessionId}
  - reads:  graph, transcript, chatHistory
  - writes: appends two entries (user + assistant) to chatHistory
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request
from google.cloud import firestore
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_google_vertexai import ChatVertexAI
from pydantic import BaseModel, Field

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
RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", 10))

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
            temperature=0.3,
            max_output_tokens=2048,
        )
    return _llm


# ============================================================================
# Structured output schema — Gemini is constrained to produce this shape
# ============================================================================
class ChatResponse(BaseModel):
    answer: str = Field(description="Plain-text response to the user's question.")
    highlightNodes: list[str] = Field(
        default_factory=list,
        description=(
            "Node ids from the graph that are most relevant to the answer. "
            "Every id MUST exist in the graph's nodes array. Empty list if "
            "no nodes are relevant."
        ),
    )


# ============================================================================
# System prompt — graph + transcript + answering instructions
# ============================================================================
CHAT_SYSTEM_PROMPT = """\
You are an assistant that helps users explore a knowledge graph extracted from a meeting transcript.

You have access to:
1. The full graph as JSON (nodes with ids, labels, types; edges with source/target).
2. The original meeting transcript for additional context.
3. The prior conversation so far.

When answering the user's question:
- Reference specific nodes from the graph by their label when helpful.
- Identify the node IDs that are most relevant to your answer — these will be
  highlighted in the UI so the user can see what you're talking about.
- Every id you put in highlightNodes MUST be a real id from the nodes array
  below. Do not invent nodes. If uncertain, return fewer ids rather than guesses.
- If no graph nodes are relevant, return an empty highlightNodes array.

GRAPH JSON:
{graph_json}

MEETING TRANSCRIPT:
{transcript}\
"""


# ============================================================================
# Helpers
# ============================================================================

def _build_messages(
    graph: dict, transcript: str, history: list[dict], new_message: str
) -> list:
    """Build the LangChain message list: system prompt + replayed history + new turn."""
    system = SystemMessage(
        content=CHAT_SYSTEM_PROMPT.format(
            graph_json=json.dumps(graph),
            transcript=transcript or "(no transcript available)",
        )
    )
    messages = [system]
    for entry in history:
        role = entry.get("role")
        content = entry.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=new_message))
    return messages


def _count_recent_user_messages(history: list[dict], window_seconds: int = 60) -> int:
    """Count user messages with createdAt within the last `window_seconds`."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    count = 0
    for entry in history:
        if entry.get("role") != "user":
            continue
        created_at = entry.get("createdAt")
        if created_at is None:
            continue
        # Firestore returns timestamps as timezone-aware datetimes
        if isinstance(created_at, datetime) and created_at >= cutoff:
            count += 1
    return count


def _filter_highlight_nodes(candidates: list, valid_ids: set[str]) -> list[str]:
    """Drop any node IDs the model invented that aren't in the real graph."""
    if not isinstance(candidates, list):
        return []
    filtered = [n for n in candidates if isinstance(n, str) and n in valid_ids]
    dropped = len(candidates) - len(filtered)
    if dropped:
        logger.warning("Dropped %d hallucinated highlightNodes ids", dropped)
    return filtered


# ============================================================================
# Flask app
# ============================================================================
app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    """Liveness / readiness probe for Cloud Run."""
    return jsonify({"status": "ok", "service": "chat-service"}), 200


@app.route("/sessions/<session_id>/chat", methods=["POST"])
def chat(session_id: str):
    # ── Validate input ───────────────────────────────────────────────────────
    body = request.get_json(silent=True) or {}
    message = body.get("message")
    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Missing or empty 'message' field"}), 400
    message = message.strip()

    # ── Load session document ────────────────────────────────────────────────
    db = get_firestore()
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "Session not found"}), 404

    session = snapshot.to_dict() or {}
    graph = session.get("graph")
    transcript = session.get("transcript", "") or ""
    history = session.get("chatHistory", []) or []

    if not graph or not isinstance(graph.get("nodes"), list):
        return jsonify({"error": "Graph not ready for this session"}), 409

    valid_ids = {n["id"] for n in graph["nodes"] if isinstance(n.get("id"), str)}

    # ── Rate limit ───────────────────────────────────────────────────────────
    recent = _count_recent_user_messages(history)
    if recent >= RATE_LIMIT_PER_MIN:
        logger.info(
            "Rate limit exceeded for session %s (%d in last 60s)", session_id, recent
        )
        return (
            jsonify({"error": "Rate limit exceeded", "retryAfter": 60}),
            429,
        )

    # ── Invoke Gemini ────────────────────────────────────────────────────────
    messages = _build_messages(graph, transcript, history, message)
    logger.info(
        "Chat | session=%s history=%d nodes=%d msg_chars=%d",
        session_id,
        len(history),
        len(valid_ids),
        len(message),
    )
    try:
        structured = get_llm().with_structured_output(ChatResponse)
        result: ChatResponse = structured.invoke(messages)
    except Exception as exc:
        logger.exception("Vertex AI call failed for session %s", session_id)
        return jsonify({"error": f"LLM invocation failed: {exc}"}), 500

    answer = result.answer
    highlight_nodes = _filter_highlight_nodes(result.highlightNodes, valid_ids)

    # ── Append both turns to chatHistory atomically ──────────────────────────
    @firestore.transactional
    def _append(tx):
        snap = session_ref.get(transaction=tx)
        current = (snap.to_dict() or {}).get("chatHistory", []) or []

        # Re-check rate limit inside the transaction to close the race window
        if _count_recent_user_messages(current) >= RATE_LIMIT_PER_MIN:
            return False

        now = datetime.now(timezone.utc)
        current.append(
            {"role": "user", "content": message, "createdAt": now}
        )
        current.append(
            {
                "role": "assistant",
                "content": answer,
                "highlightNodes": highlight_nodes,
                "createdAt": now,
            }
        )
        tx.set(
            session_ref,
            {"chatHistory": current, "updatedAt": now},
            merge=True,
        )
        return True

    try:
        appended = _append(db.transaction())
    except Exception:
        logger.exception("Failed to append chat turns for session %s", session_id)
        return jsonify({"error": "Failed to persist chat history"}), 500

    if not appended:
        return (
            jsonify({"error": "Rate limit exceeded", "retryAfter": 60}),
            429,
        )

    return jsonify({"answer": answer, "highlightNodes": highlight_nodes}), 200


# ============================================================================
# Entry point (local dev — Cloud Run uses gunicorn via Dockerfile CMD)
# ============================================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=False)
