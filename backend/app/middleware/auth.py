from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from app.config import settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# Default API key value that ships with the repo -- treat as "not configured"
_DEFAULT_API_KEY = "dev-api-key-change-me"


def require_api_key(
    request: Request,
    api_key: str | None = Security(_api_key_header),
) -> str:
    """FastAPI dependency that validates the X-API-Key header.

    Skips auth for:
      - /api/config/* endpoints (needed during initial setup)
      - /api/health
      - Non-API routes (static files / SPA)
      - When the API key is still the default placeholder (first run)

    Returns the user_id (always 'default' for v1).
    """
    path = request.url.path

    # Skip auth for non-API routes (frontend static files)
    if not path.startswith("/api/"):
        return "default"

    # Skip auth for config status endpoint (needed for setup redirect check)
    if path == "/api/config/status":
        return "default"

    # Skip auth for config endpoints ONLY when API key is still the default
    # (first-time setup flow needs these before a real key is configured)
    if path.startswith("/api/config") and settings.api_key == _DEFAULT_API_KEY:
        return "default"

    # Skip auth for health check
    if path == "/api/health":
        return "default"

    # Skip auth when API key is still the default (not yet configured)
    if settings.api_key == _DEFAULT_API_KEY:
        return "default"

    # Otherwise, require a valid API key
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "MISSING_API_KEY",
                    "message": "X-API-Key header is required",
                }
            },
        )
    if api_key != settings.api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "INVALID_API_KEY",
                    "message": "Invalid API key",
                }
            },
        )
    return "default"
