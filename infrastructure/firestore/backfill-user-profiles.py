#!/usr/bin/env python3
"""
Backfill Firestore user profile documents from Firebase Auth users.

Creates or repairs `users/{uid}` docs to include:
  - email
  - createdAt
  - stats.totalSessions
  - stats.totalNodes
  - stats.totalAudioMinutes

Safe behavior:
  - Existing values are preserved.
  - Missing fields are added only.
  - Existing counters are never reset.

Usage:
  python infrastructure/firestore/backfill-user-profiles.py --project YOUR_PROJECT_ID --dry-run
  python infrastructure/firestore/backfill-user-profiles.py --project YOUR_PROJECT_ID

Auth:
  Uses Application Default Credentials by default. Set GOOGLE_APPLICATION_CREDENTIALS
  or run `gcloud auth application-default login`.
"""

from __future__ import annotations

import argparse
from typing import Any, Dict

import firebase_admin
from firebase_admin import auth, credentials
from google.cloud import firestore


DEFAULT_STATS = {
    "totalSessions": 0,
    "totalNodes": 0,
    "totalAudioMinutes": 0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill users/{uid} profile docs")
    parser.add_argument("--project", required=True, help="GCP / Firebase project ID")
    parser.add_argument(
        "--credentials",
        default=None,
        help="Path to a Firebase service account JSON key (optional)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without writing to Firestore",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of Auth users to process",
    )
    return parser.parse_args()


def init_firebase(project: str, credentials_path: str | None) -> None:
    if credentials_path:
        cred = credentials.Certificate(credentials_path)
        firebase_admin.initialize_app(cred, {"projectId": project})
        return

    firebase_admin.initialize_app(options={"projectId": project})


def build_missing_updates(existing: Dict[str, Any], user_email: str | None) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}

    if not existing.get("email") and user_email:
        updates["email"] = user_email

    if "createdAt" not in existing:
        updates["createdAt"] = firestore.SERVER_TIMESTAMP

    stats = existing.get("stats")
    if stats is None:
        updates["stats"] = DEFAULT_STATS.copy()
        return updates

    if not isinstance(stats, dict):
        updates["stats"] = DEFAULT_STATS.copy()
        return updates

    for field_name, default_value in DEFAULT_STATS.items():
        if field_name not in stats:
            updates[f"stats.{field_name}"] = default_value

    return updates


def apply_for_user(
    db: firestore.Client,
    uid: str,
    user_email: str | None,
    dry_run: bool,
) -> str:
    user_ref = db.collection("users").document(uid)
    snapshot = user_ref.get()

    if not snapshot.exists:
        payload: Dict[str, Any] = {
            "email": user_email or "",
            "createdAt": firestore.SERVER_TIMESTAMP,
            "stats": DEFAULT_STATS.copy(),
        }

        if dry_run:
            return f"CREATE users/{uid}"

        user_ref.set(payload, merge=False)
        return f"CREATED users/{uid}"

    existing = snapshot.to_dict() or {}
    updates = build_missing_updates(existing, user_email)

    if not updates:
        return f"UNCHANGED users/{uid}"

    if dry_run:
        return f"UPDATE users/{uid} fields={sorted(updates.keys())}"

    user_ref.set(updates, merge=True)
    return f"UPDATED users/{uid} fields={sorted(updates.keys())}"


def iter_auth_users(limit: int | None):
    processed = 0
    page = auth.list_users()

    while page is not None:
        for user in page.users:
            yield user
            processed += 1
            if limit is not None and processed >= limit:
                return

        page = page.get_next_page()


def main() -> None:
    args = parse_args()
    init_firebase(args.project, args.credentials)

    db = firestore.Client(project=args.project)

    print(f"Backfilling users/{{uid}} profiles for project={args.project}")
    if args.dry_run:
        print("Mode: dry-run (no writes)")

    created = 0
    updated = 0
    unchanged = 0
    processed = 0

    for user in iter_auth_users(args.limit):
        processed += 1
        result = apply_for_user(db, user.uid, user.email, args.dry_run)
        print(result)

        if result.startswith("CREATE") or result.startswith("CREATED"):
            created += 1
        elif result.startswith("UPDATE") or result.startswith("UPDATED"):
            updated += 1
        else:
            unchanged += 1

    print("\nDone.")
    print(f"Processed: {processed}")
    print(f"Created:   {created}")
    print(f"Updated:   {updated}")
    print(f"Unchanged: {unchanged}")


if __name__ == "__main__":
    main()
