"""In-memory event bus for SSE streaming of analysis progress.

Each analysis job gets an AnalysisEventStream instance.  The background
analysis thread calls ``emit()`` to publish events; the SSE endpoint
calls ``subscribe()`` to consume them.  Thread safety is ensured via a
threading.Lock for the event list and a threading.Event for wakeup
signalling.

Streams are kept in a global registry and automatically cleaned up
after a configurable retention period (default 5 minutes) so that
late-connecting clients can still catch up.
"""

import threading
import time
from typing import Generator

from app.utils import utc_now

# ---------------------------------------------------------------------------
# Event stream for a single job
# ---------------------------------------------------------------------------


class AnalysisEventStream:
    """Thread-safe event stream for a single analysis job.

    Writers (background thread) call ``emit()``.
    Readers (async SSE endpoint) call ``subscribe()`` which yields events
    as they arrive, blocking until new events are available or the stream
    is marked complete.
    """

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.events: list[dict] = []
        self._lock = threading.Lock()
        self._new_event = threading.Event()
        self._complete = False
        self._created_at = time.monotonic()

    # -- Writer API (called from background thread) -------------------------

    def emit(self, event_type: str, data: dict) -> None:
        """Append a new event and wake any waiting subscribers."""
        with self._lock:
            event = {
                "id": len(self.events),
                "timestamp": utc_now(),
                "type": event_type,
                "data": data,
            }
            self.events.append(event)
        # Wake blocked subscribers
        self._new_event.set()

    def mark_complete(self) -> None:
        """Signal that no more events will be emitted for this stream."""
        self._complete = True
        self._new_event.set()

    # -- Reader API (called from SSE endpoint) ------------------------------

    @property
    def is_complete(self) -> bool:
        return self._complete

    def subscribe(self, last_id: int = -1) -> Generator[dict, None, None]:
        """Yield all events with id > last_id that are currently available.

        This does NOT block; the caller is responsible for polling or
        sleeping between calls.  This design avoids holding a thread
        lock across an async boundary.
        """
        with self._lock:
            start_idx = last_id + 1
            if start_idx < len(self.events):
                # Yield a snapshot of new events
                for event in self.events[start_idx:]:
                    yield event

    def wait_for_event(self, timeout: float = 0.5) -> bool:
        """Block until a new event is emitted or timeout expires.

        Returns True if an event was signalled, False on timeout.
        Clears the internal flag so the next call will block again.
        """
        triggered = self._new_event.wait(timeout=timeout)
        self._new_event.clear()
        return triggered


# ---------------------------------------------------------------------------
# Global registry of active streams
# ---------------------------------------------------------------------------

_streams: dict[str, AnalysisEventStream] = {}
_registry_lock = threading.Lock()

# How long (seconds) to keep a completed stream in the registry so that
# late-connecting clients can still retrieve events.
_RETENTION_SECONDS = 300  # 5 minutes


def create_event_stream(job_id: str) -> AnalysisEventStream:
    """Create and register a new event stream for a job.

    Also garbage-collects expired streams.
    """
    stream = AnalysisEventStream(job_id)
    with _registry_lock:
        _streams[job_id] = stream
        _gc_expired_streams()
    return stream


def get_event_stream(job_id: str) -> AnalysisEventStream | None:
    """Look up an active event stream by job ID."""
    with _registry_lock:
        return _streams.get(job_id)


def remove_event_stream(job_id: str) -> None:
    """Explicitly remove a stream from the registry."""
    with _registry_lock:
        _streams.pop(job_id, None)


def _gc_expired_streams() -> None:
    """Remove completed streams older than the retention period.

    Must be called while holding ``_registry_lock``.
    """
    now = time.monotonic()
    expired = [
        jid
        for jid, s in _streams.items()
        if s.is_complete and (now - s._created_at) > _RETENTION_SECONDS
    ]
    for jid in expired:
        del _streams[jid]
