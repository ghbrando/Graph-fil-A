"""
Unit tests for orphan_cleanup/main.py

Run with:  pytest tests/test_orphan_cleanup.py -v
"""

import sys
import types
from datetime import datetime, timezone, timedelta
from importlib import util
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from flask import Flask

_flask_app = Flask(__name__)

# ---------------------------------------------------------------------------
# Bootstrap: stub out GCP SDK imports so tests run without credentials
# ---------------------------------------------------------------------------
def _make_stub_module(name):
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod

for _mod in [
    "google", "google.cloud", "google.cloud.firestore",
    "google.cloud.storage", "functions_framework",
]:
    if _mod not in sys.modules:
        _make_stub_module(_mod)

# Provide just enough of the firestore API used in main.py
gf = sys.modules["google.cloud.firestore"]
gf.Client = MagicMock
gf.Increment = lambda x: x

gs = sys.modules["google.cloud.storage"]
gs.Client = MagicMock

ff = sys.modules["functions_framework"]
ff.http = lambda f: f        # identity decorator for @functions_framework.http

# Patch env vars before importing the module
import os
os.environ.setdefault("AUDIO_BUCKET_NAME", "test-audio-bucket")
os.environ.setdefault("ORPHAN_AGE_HOURS", "24")

# Now import the module under test from its file path
_MODULE_PATH = Path(__file__).resolve().parent.parent / "functions" / "orphan-cleanup" / "main.py"
_SPEC = util.spec_from_file_location("orphan_cleanup_main", _MODULE_PATH)
assert _SPEC and _SPEC.loader
m = util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(m)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
NOW = datetime.now(timezone.utc)
OLD = NOW - timedelta(hours=25)    # older than threshold
RECENT = NOW - timedelta(hours=1)  # younger than threshold

def _mock_blob(name: str, created: datetime) -> MagicMock:
    blob = MagicMock()
    blob.name = name
    blob.time_created = created
    return blob


def _mock_snap(exists: bool, data: dict | None = None) -> MagicMock:
    snap = MagicMock()
    snap.exists = exists
    snap.to_dict.return_value = data or {}
    return snap


# ---------------------------------------------------------------------------
# _extract_session_id
# ---------------------------------------------------------------------------

class TestExtractSessionId:
    def test_valid_path(self):
        assert m._extract_session_id("sessions/abc123/audio.webm") == "abc123"

    def test_deep_path(self):
        assert m._extract_session_id("sessions/xyz/sub/audio.mp3") == "xyz"

    def test_missing_prefix(self):
        assert m._extract_session_id("uploads/abc/audio.webm") is None

    def test_too_short(self):
        assert m._extract_session_id("sessions") is None

    def test_two_parts_only(self):
        # "sessions/abc" — only 2 parts, not 3 — should return None
        assert m._extract_session_id("sessions/abc") is None


# ---------------------------------------------------------------------------
# _evaluate_blob
# ---------------------------------------------------------------------------

class TestEvaluateBlob:
    def test_no_session_should_delete(self):
        snap = _mock_snap(exists=False)
        with patch.object(m.db, "collection") as col:
            col.return_value.document.return_value.get.return_value = snap
            should_delete, reason = m._evaluate_blob("missing-id", "gs://bucket/blob")
        assert should_delete is True
        assert reason == "no_session"

    @pytest.mark.parametrize("status", ["uploading", "transcribing"])
    def test_stale_status_should_delete(self, status):
        snap = _mock_snap(exists=True, data={"status": status})
        with patch.object(m.db, "collection") as col:
            col.return_value.document.return_value.get.return_value = snap
            should_delete, reason = m._evaluate_blob("stale-id", "gs://bucket/blob")
        assert should_delete is True
        assert reason == "stale_status"

    @pytest.mark.parametrize("status", ["ready", "summarizing", "error"])
    def test_healthy_or_terminal_should_retain(self, status):
        snap = _mock_snap(exists=True, data={"status": status})
        with patch.object(m.db, "collection") as col:
            col.return_value.document.return_value.get.return_value = snap
            should_delete, reason = m._evaluate_blob("healthy-id", "gs://bucket/blob")
        assert should_delete is False
        assert reason == "healthy"


# ---------------------------------------------------------------------------
# handle_orphan_cleanup — integration-level
# ---------------------------------------------------------------------------

class TestHandleOrphanCleanup:

    def _run(self, blobs, session_snaps: dict):
        """
        Invoke handle_orphan_cleanup with mocked GCS and Firestore.

        session_snaps: mapping of sessionId → firestore snapshot mock
        """
        request = MagicMock()

        with patch.object(m.gcs, "bucket") as mock_bucket_fn, \
             patch.object(m.db, "collection") as mock_col:

            # GCS
            mock_bucket = MagicMock()
            mock_bucket.list_blobs.return_value = blobs
            mock_bucket_fn.return_value = mock_bucket

            # Firestore: route by session_id
            def _doc_get_side_effect(session_id):
                snap = MagicMock()
                if session_id in session_snaps:
                    snap.exists = True
                    snap.to_dict.return_value = session_snaps[session_id]
                else:
                    snap.exists = False
                    snap.to_dict.return_value = {}
                return snap

            doc_mock = MagicMock()
            doc_mock.get.side_effect = lambda: _doc_get_side_effect(doc_mock._session_id)

            def _document_factory(sid):
                d = MagicMock()
                d._session_id = sid
                d.get.side_effect = lambda: _doc_get_side_effect(sid)
                return d

            mock_col.return_value.document.side_effect = _document_factory

            with _flask_app.app_context():
                response, status = m.handle_orphan_cleanup(request)

        return response.get_json(), status

    def test_skips_recent_blobs(self):
        blobs = [_mock_blob("sessions/s1/audio.webm", RECENT)]
        result, status = self._run(blobs, {})
        assert status == 200
        assert result["stats"]["blobs_skipped_recent"] == 1
        assert result["stats"]["blobs_deleted_no_session"] == 0

    def test_deletes_orphan_no_session(self):
        blobs = [_mock_blob("sessions/s1/audio.webm", OLD)]
        result, status = self._run(blobs, {})  # no session for s1
        assert status == 200
        assert result["stats"]["blobs_deleted_no_session"] == 1

    def test_deletes_stale_uploading(self):
        blobs = [_mock_blob("sessions/s2/audio.webm", OLD)]
        result, status = self._run(blobs, {"s2": {"status": "uploading"}})
        assert status == 200
        assert result["stats"]["blobs_deleted_stale_status"] == 1

    def test_retains_ready_session(self):
        blobs = [_mock_blob("sessions/s3/audio.webm", OLD)]
        result, status = self._run(blobs, {"s3": {"status": "ready"}})
        assert status == 200
        assert result["stats"]["blobs_retained"] == 1
        assert result["stats"]["blobs_deleted_no_session"] == 0

    def test_mixed_blobs(self):
        blobs = [
            _mock_blob("sessions/orphan/audio.webm", OLD),        # no session → delete
            _mock_blob("sessions/stale/audio.webm", OLD),         # uploading → delete
            _mock_blob("sessions/healthy/audio.webm", OLD),       # ready → retain
            _mock_blob("sessions/new/audio.webm", RECENT),        # too recent → skip
        ]
        sessions = {
            "stale":   {"status": "uploading"},
            "healthy": {"status": "ready"},
        }
        result, status = self._run(blobs, sessions)
        assert status == 200
        s = result["stats"]
        assert s["blobs_scanned"] == 4
        assert s["blobs_skipped_recent"] == 1
        assert s["blobs_deleted_no_session"] == 1
        assert s["blobs_deleted_stale_status"] == 1
        assert s["blobs_retained"] == 1
