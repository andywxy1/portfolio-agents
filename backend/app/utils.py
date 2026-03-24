"""Shared utility helpers used across the backend."""

from datetime import datetime, timezone


def utc_now() -> str:
    """Return the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
