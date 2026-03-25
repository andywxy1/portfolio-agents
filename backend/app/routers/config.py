"""Configuration management endpoints.

GET  /api/config          - Returns current config (secrets masked)
PUT  /api/config          - Updates config, writes to .env, reloads
GET  /api/config/status   - Returns setup status (no auth required)
POST /api/config/validate - Tests Alpaca and LLM connections
"""

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import Settings, settings
from app.middleware.auth import require_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"])

# Keys the frontend is allowed to read/write
_ALLOWED_KEYS = {
    "API_KEY",
    "ALPACA_API_KEY",
    "ALPACA_SECRET_KEY",
    "ALPACA_BASE_URL",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_DEEP_MODEL",
    "LLM_QUICK_MODEL",
    "OPENAI_API_KEY",
    "WEIGHT_HEAVY_THRESHOLD",
    "WEIGHT_MEDIUM_THRESHOLD",
    "PORT",
}

# Keys whose values should be masked in GET responses
_SECRET_KEYS = {"API_KEY", "ALPACA_API_KEY", "ALPACA_SECRET_KEY", "LLM_API_KEY", "OPENAI_API_KEY"}

# Keys that must be set for the system to be functional
_REQUIRED_KEYS = {"ALPACA_API_KEY", "ALPACA_SECRET_KEY", "LLM_BASE_URL"}

_ENV_PATH = Path(__file__).parent.parent.parent / ".env"


def _mask(value: str) -> str:
    """Mask a secret value, showing only the last 4 characters."""
    if not value or len(value) <= 4:
        return "****"
    return "*" * (len(value) - 4) + value[-4:]


def _settings_attr(key: str) -> str:
    """Convert an ENV_KEY to the Settings attribute name (lowercase)."""
    return key.lower()


def _get_current_config() -> dict[str, Any]:
    """Read current settings and return as a dict with secrets masked."""
    result: dict[str, Any] = {}
    for key in _ALLOWED_KEYS:
        attr = _settings_attr(key)
        value = getattr(settings, attr, None)
        if value is None:
            result[key] = ""
            continue
        str_value = str(value)
        if key in _SECRET_KEYS and str_value:
            result[key] = _mask(str_value)
        else:
            result[key] = str_value
    return result


def _read_env_file() -> dict[str, str]:
    """Parse the .env file into a dict. Returns empty dict if file missing."""
    env_vars: dict[str, str] = {}
    if not _ENV_PATH.exists():
        return env_vars
    for line in _ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        # Strip optional surrounding quotes
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        env_vars[k.strip()] = v
    return env_vars


def _write_env_file(env_vars: dict[str, str]) -> None:
    """Write a dict back to the .env file. Values are double-quoted."""
    lines = [f'{k}="{v}"' for k, v in sorted(env_vars.items())]
    _ENV_PATH.write_text("\n".join(lines) + "\n")


def _reload_settings(env_vars: dict[str, str]) -> None:
    """Update the global settings object in-place from the written env values.

    Weight threshold values are normalised to fractions (0-1) if they arrive
    as percentage integers (e.g. 10 instead of 0.10) from the frontend.

    Each field is validated individually -- an invalid value for one field
    does not prevent other fields from being applied.
    """
    _WEIGHT_THRESHOLD_KEYS = {"WEIGHT_HEAVY_THRESHOLD", "WEIGHT_MEDIUM_THRESHOLD"}

    for key in _ALLOWED_KEYS:
        attr = _settings_attr(key)
        if key in env_vars and hasattr(settings, attr):
            raw = env_vars[key]
            # Convert to the right type based on the field
            field_info = Settings.model_fields.get(attr)
            if field_info is not None:
                annotation = field_info.annotation
                try:
                    if annotation is float:
                        value = float(raw)
                        # Normalise weight thresholds sent as percentages
                        if key in _WEIGHT_THRESHOLD_KEYS and value > 1:
                            value = value / 100.0
                        # Validate: weight thresholds must be in [0, 1]
                        if key in _WEIGHT_THRESHOLD_KEYS and not (0 <= value <= 1):
                            logger.warning(
                                "Invalid value for %s: %.4f (must be between 0 and 1); skipping",
                                key, value,
                            )
                            continue
                        object.__setattr__(settings, attr, value)
                    elif annotation is int:
                        int_value = int(raw)
                        if key == "PORT" and not (1 <= int_value <= 65535):
                            logger.warning(
                                "Invalid value for PORT: %d (must be 1-65535); skipping",
                                int_value,
                            )
                            continue
                        object.__setattr__(settings, attr, int_value)
                    else:
                        object.__setattr__(settings, attr, raw)
                except (ValueError, TypeError) as exc:
                    logger.warning(
                        "Invalid value for config key %s: %r (%s); skipping",
                        key, raw, exc,
                    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def get_config(
    user_id: str = Depends(require_api_key),
) -> dict[str, Any]:
    """Return current configuration with secrets masked."""
    return _get_current_config()


class ConfigUpdate(BaseModel):
    """Flexible config update body -- any subset of allowed keys."""
    model_config = {"extra": "allow"}


@router.put("")
async def update_config(
    body: ConfigUpdate,
    user_id: str = Depends(require_api_key),
) -> dict[str, Any]:
    """Update configuration values, write to .env, and reload."""
    raw = body.model_dump(exclude_unset=True)

    # Normalize keys to uppercase (frontend sends lowercase)
    updates = {k.upper(): v for k, v in raw.items()}

    # Validate keys
    invalid_keys = set(updates.keys()) - _ALLOWED_KEYS
    if invalid_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_CONFIG_KEYS",
                    "message": f"Unknown config keys: {', '.join(sorted(invalid_keys))}",
                }
            },
        )

    # Skip masked values -- the frontend sends back "****..." for secrets
    # that the user didn't change; writing those would overwrite the real value.
    updates = {k: v for k, v in updates.items() if "****" not in str(v)}

    # Auto-set OPENAI_API_KEY when LLM_API_KEY is provided
    if "LLM_API_KEY" in updates and "OPENAI_API_KEY" not in updates:
        updates["OPENAI_API_KEY"] = updates["LLM_API_KEY"]

    # Read existing .env, merge, write back
    env_vars = _read_env_file()
    for key, value in updates.items():
        env_vars[key] = str(value)

    _write_env_file(env_vars)
    _reload_settings(env_vars)

    logger.info("Config updated: keys=%s", list(updates.keys()))
    return _get_current_config()


@router.get("/status")
async def get_config_status() -> dict[str, Any]:
    """Return setup status -- which required keys are missing."""
    missing: list[str] = []
    for key in sorted(_REQUIRED_KEYS):
        attr = _settings_attr(key)
        value = getattr(settings, attr, None)
        if not value:
            missing.append(key)

    return {
        "configured": len(missing) == 0,
        "missing_keys": missing,
    }


class _ConnectionResult(BaseModel):
    ok: bool
    error: str | None = None


class ValidateResponse(BaseModel):
    alpaca: _ConnectionResult
    llm: _ConnectionResult


class ValidateRequest(BaseModel):
    """Optional overrides — use form values instead of saved settings."""
    alpaca_api_key: str | None = None
    alpaca_secret_key: str | None = None
    alpaca_base_url: str | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_quick_model: str | None = None


@router.post("/validate", response_model=ValidateResponse)
def validate_connections(body: ValidateRequest | None = None) -> ValidateResponse:
    """Test Alpaca and LLM connections. Uses request body values if provided, else saved settings."""
    overrides = body.model_dump(exclude_none=True) if body else {}
    alpaca_result = _test_alpaca(overrides)
    llm_result = _test_llm(overrides)
    return ValidateResponse(alpaca=alpaca_result, llm=llm_result)


def _test_alpaca(overrides: dict) -> _ConnectionResult:
    """Try fetching an AAPL quote via Alpaca."""
    api_key = overrides.get("alpaca_api_key") or settings.alpaca_api_key
    secret_key = overrides.get("alpaca_secret_key") or settings.alpaca_secret_key

    if not api_key or not secret_key:
        return _ConnectionResult(ok=False, error="Alpaca API key or secret key not configured")

    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockLatestQuoteRequest

        client = StockHistoricalDataClient(
            api_key=api_key,
            secret_key=secret_key,
        )
        request = StockLatestQuoteRequest(symbol_or_symbols="AAPL")
        quotes = client.get_stock_latest_quote(request)
        if "AAPL" not in quotes:
            return _ConnectionResult(ok=False, error="No quote data returned for AAPL")
        return _ConnectionResult(ok=True)
    except ImportError:
        return _ConnectionResult(ok=False, error="alpaca-py package not installed")
    except Exception as exc:
        return _ConnectionResult(ok=False, error=str(exc)[:200])


def _test_llm(overrides: dict) -> _ConnectionResult:
    """Try a simple chat completion against the configured LLM endpoint."""
    base_url = overrides.get("llm_base_url") or settings.llm_base_url
    api_key = overrides.get("llm_api_key") or settings.llm_api_key or settings.openai_api_key or "no-key"
    model = overrides.get("llm_quick_model") or settings.llm_quick_model

    if not base_url:
        return _ConnectionResult(ok=False, error="LLM base URL not configured")

    try:
        import httpx

        response = httpx.post(
            f"{base_url.rstrip('/')}/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": "say hello"}],
                "max_tokens": 16,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )

        if response.status_code >= 400:
            return _ConnectionResult(
                ok=False,
                error=f"HTTP {response.status_code}: {response.text[:200]}",
            )

        data = response.json()
        if "choices" not in data:
            return _ConnectionResult(ok=False, error="Unexpected response format from LLM")

        return _ConnectionResult(ok=True)
    except httpx.ConnectError as exc:
        return _ConnectionResult(ok=False, error=f"Cannot connect to LLM endpoint: {exc}")
    except Exception as exc:
        return _ConnectionResult(ok=False, error=str(exc)[:200])
