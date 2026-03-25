"""Shared utility helpers used across the backend."""

from datetime import datetime, timezone


def utc_now() -> str:
    """Return the current UTC timestamp as an ISO 8601 string with real milliseconds."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
