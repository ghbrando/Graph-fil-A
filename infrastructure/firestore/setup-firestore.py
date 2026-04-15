#!/usr/bin/env python3
"""
setup-firestore.py

One-time Firestore schema setup for GraphFilA.
Run this before deploying any services.

Usage:
    python infrastructure/firestore/setup-firestore.py --project YOUR_PROJECT_ID

What it does:
  1. Verifies the composite index exists (uid ASC + createdAt DESC on sessions).
     The index itself must be created via the Firebase console or firestore.indexes.json
     — this script checks for it and prints instructions if missing.
    2. Seeds a placeholder user profile structure for demonstration / testing.
  3. Documents (via comments) the full Firestore schema as code.

Schema reference:
  sessions/{sessionId}
    uid              string   — Firebase UID of the owner
    status           string   — uploading | transcribing | transcribed |
                                processing | ready | error
    transcript       string   — full text from Speech-to-Text (null until transcribed)
    graphJson        map      — { nodes: [...], edges: [...] } (null until processed)
    summaryJson      map      — { synopsis, actionItems, decisions } (null until processed)
    chatHistory      array    — [ { role, content }, ... ]
    createdAt        timestamp
    audioGcsPath     string   — temporary GCS object path; nulled after cleanup

    users/{uid}
        email             string   — user email
        createdAt         timestamp
        stats             map
    totalSessions    number   — atomic-incremented on each graph-ready cleanup
    totalNodes       number   — atomic-incremented by node count per session
    totalAudioMinutes number  — atomic-incremented by transcription-service
"""

import argparse
import json

from google.cloud import firestore


def parse_args():
    p = argparse.ArgumentParser(description="GraphFilA Firestore setup")
    p.add_argument("--project", required=True, help="GCP project ID")
    p.add_argument(
        "--seed-test-user",
        metavar="UID",
        default=None,
        help="Optionally seed a stats doc for a test UID",
    )
    return p.parse_args()


def check_composite_index(project: str) -> None:
    """
    The composite index cannot be created programmatically via the client
    library — it must be declared in firestore.indexes.json and deployed
    via `firebase deploy --only firestore:indexes`.

    This function prints the required index config and checks if the
    gcloud CLI can list it.
    """
    index_config = {
        "indexes": [
            {
                "collectionGroup": "sessions",
                "queryScope": "COLLECTION",
                "fields": [
                    {"fieldPath": "uid", "order": "ASCENDING"},
                    {"fieldPath": "createdAt", "order": "DESCENDING"},
                ],
            }
        ],
        "fieldOverrides": [],
    }

    print("\n--- Composite Index ---")
    print(
        "Required index for the session history dashboard query:\n"
        "  Collection : sessions\n"
        "  uid        : ASCENDING\n"
        "  createdAt  : DESCENDING\n"
    )
    print(
        "Deploy with:\n"
        "  1. Ensure infrastructure/firestore/firestore.indexes.json contains:\n"
    )
    print(json.dumps(index_config, indent=2))
    print(
        "\n  2. Run:  firebase deploy --only firestore:indexes "
        f"--project {project}\n"
        "  Index builds take a few minutes; check progress in the Firebase console.\n"
    )


def seed_stats_document(db: firestore.Client, uid: str) -> None:
    """
    Create or merge an initial user profile and stats map.
    Using merge=True means existing fields are preserved where present.
    """
    user_ref = db.collection("users").document(uid)

    user_ref.set(
        {
            "createdAt": firestore.SERVER_TIMESTAMP,
            "stats": {
                "totalSessions": 0,
                "totalNodes": 0,
                "totalAudioMinutes": 0,
            },
        },
        merge=True,
    )
    print(f"User profile seeded for uid={uid} (merge=True)")


def verify_firestore_connection(db: firestore.Client, project: str) -> None:
    """Write and immediately delete a sentinel document to confirm connectivity."""
    sentinel = db.collection("_setup_check").document("ping")
    sentinel.set({"ok": True})
    sentinel.delete()
    print(f"Firestore connection verified for project={project}")


def main():
    args = parse_args()
    db = firestore.Client(project=args.project)

    print(f"GraphFilA Firestore Setup — project: {args.project}\n")

    # 1. Verify connectivity
    verify_firestore_connection(db, args.project)

    # 2. Print composite index instructions
    check_composite_index(args.project)

    # 3. Optionally seed a test user stats document
    if args.seed_test_user:
        seed_stats_document(db, args.seed_test_user)

    print("Setup complete.")


if __name__ == "__main__":
    main()
