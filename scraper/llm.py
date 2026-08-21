#!/usr/bin/env python3
"""
scraper/llm.py — centralised LLM provider for the e-Jagriti extraction pipeline.

This module owns all model selection, credential resolution, HTTP calls,
retries, and fallback logic.  Import ``call_llm`` here; do not duplicate
provider code in individual scripts.

─────────────────────────────────────────────────────────────────────
CONFIGURATION  (environment variables)
─────────────────────────────────────────────────────────────────────
Primary model (default: provider-appropriate)
  LLM_PRIMARY_PROVIDER   "gemini" or "openai"       (auto-detected if omitted)
  LLM_PRIMARY_MODEL      model name                 (default depends on provider:
                                                       gemini → gemini-2.5-flash-lite
                                                       openai → gpt-4o-mini)

Fallback model (triggered on non-retryable primary failure)
  LLM_FALLBACK_PROVIDER  "gemini" or "openai"       (default: the other provider)
  LLM_FALLBACK_MODEL     model name                 (default depends on provider)

Gemini credentials
  GEMINI_API_KEY         Google AI / Vertex key — use this for direct API access
  GEMINI_BASE_URL        Proxy base URL (e.g. a self-hosted Gemini-compatible proxy)

OpenAI credentials
  OPENAI_API_KEY         OpenAI key (or key for any OpenAI-compatible API)
  OPENAI_BASE_URL        Custom base URL (Azure, local proxy, etc.)

Backward-compatible aliases (still honoured, but canonical names above are preferred)
  EXTRACT_MODEL          → LLM_PRIMARY_MODEL
  OPENAI_EXTRACT_MODEL   → LLM_FALLBACK_MODEL

Cost tracking
  LLM_PRICING_JSON       JSON object of {"model-name": [input_rate, output_rate]}
                         (USD per 1M tokens) merged over the built-in pricing table.
                         Set this when using a model not in that table, so
                         TOKEN_DAILY_CAP_USD enforcement in extract.py stays accurate.
─────────────────────────────────────────────────────────────────────
"""

import datetime
import json
import os
import time
from email.utils import parsedate_to_datetime
from typing import Optional

import requests as http

# ──────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────

def _env(*keys: str, default: str = "") -> str:
    """Return the value of the first env var in *keys* that is set and non-empty."""
    for k in keys:
        v = os.environ.get(k, "").strip()
        if v:
            return v
    return default


# ──────────────────────────────────────────────────────────────────
# Known pricing (USD per 1M tokens): (input_rate, output_rate)
# ──────────────────────────────────────────────────────────────────

_PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash":      (0.30, 2.50),
    "gpt-4o-mini":           (0.15, 0.60),
    "gpt-4o":                (5.00, 15.00),
}
_DEFAULT_PRICING: tuple[float, float] = (0.10, 0.40)

# LLM_PRIMARY_MODEL/LLM_FALLBACK_MODEL can be set to any model name, including
# ones not in _PRICING above (a newer model, a fine-tune, an Azure deployment
# name). Set LLM_PRICING_JSON to add/override entries without editing code —
# a JSON object of {"model-name": [input_rate, output_rate]} in USD per 1M
# tokens, e.g.: LLM_PRICING_JSON='{"gemini-3-flash": [0.20, 1.00]}'
_env_pricing_raw = _env("LLM_PRICING_JSON")
if _env_pricing_raw:
    try:
        _PRICING = {**_PRICING, **{k: tuple(v) for k, v in json.loads(_env_pricing_raw).items()}}
    except (json.JSONDecodeError, TypeError, ValueError) as _exc:
        print(f"[llm] WARNING: LLM_PRICING_JSON is not valid JSON ({_exc}); ignoring it.")

_warned_unpriced_models: set[str] = set()


def get_pricing(model: str) -> tuple[float, float]:
    """Return *(input_rate, output_rate)* in USD per 1M tokens for *model*.

    Falls back to _DEFAULT_PRICING (flash-lite-tier rates) for any model not
    in _PRICING/LLM_PRICING_JSON — this makes cost tracking silently wrong
    for that model, so warn once per model rather than staying silent.
    """
    if model in _PRICING:
        return _PRICING[model]
    if model not in _warned_unpriced_models:
        _warned_unpriced_models.add(model)
        print(
            f"[llm] WARNING: no pricing entry for model {model!r} — cost tracking will use "
            f"default rates {_DEFAULT_PRICING} USD/1M tokens, which may be inaccurate. "
            f"Set LLM_PRICING_JSON to add the correct rate for this model."
        )
    return _DEFAULT_PRICING


# ──────────────────────────────────────────────────────────────────
# Provider auto-detection  (must happen BEFORE model defaults)
# ──────────────────────────────────────────────────────────────────

def _gemini_configured() -> bool:
    return bool(
        _env("GEMINI_API_KEY")
        or _env("GEMINI_BASE_URL")
    )


def _openai_configured() -> bool:
    return bool(
        _env("OPENAI_API_KEY")
        or _env("OPENAI_BASE_URL")
    )


def _resolve_primary_provider() -> str:
    explicit = _env("LLM_PRIMARY_PROVIDER").lower()
    if explicit in ("gemini", "openai"):
        return explicit
    # Auto-detect: prefer Gemini when its credentials are present.
    if _gemini_configured():
        return "gemini"
    if _openai_configured():
        return "openai"
    return "gemini"  # default; the call will fail with a clear message if unconfigured


def _resolve_fallback_provider(primary: str) -> str:
    explicit = _env("LLM_FALLBACK_PROVIDER").lower()
    if explicit in ("gemini", "openai"):
        return explicit
    # Default: the other provider.
    return "openai" if primary == "gemini" else "gemini"


PRIMARY_PROVIDER: str  = _resolve_primary_provider()
FALLBACK_PROVIDER: str = _resolve_fallback_provider(PRIMARY_PROVIDER)


# ──────────────────────────────────────────────────────────────────
# Model resolution  (runs after providers so defaults are appropriate)
# ──────────────────────────────────────────────────────────────────

# Provider-appropriate model defaults — used when no explicit override is set.
_DEFAULT_MODELS: dict[str, str] = {
    "gemini": "gemini-2.5-flash-lite",
    "openai": "gpt-4o-mini",
}


def _resolve_primary_model() -> str:
    # Explicit override (canonical or legacy name) takes priority.
    explicit = _env("LLM_PRIMARY_MODEL", "EXTRACT_MODEL")
    if explicit:
        return explicit
    # Fall back to the provider-appropriate default.
    return _DEFAULT_MODELS.get(PRIMARY_PROVIDER, "gemini-2.5-flash-lite")


def _resolve_fallback_model() -> str:
    explicit = _env("LLM_FALLBACK_MODEL", "OPENAI_EXTRACT_MODEL")
    if explicit:
        return explicit
    return _DEFAULT_MODELS.get(FALLBACK_PROVIDER, "gpt-4o-mini")


PRIMARY_MODEL: str  = _resolve_primary_model()
FALLBACK_MODEL: str = _resolve_fallback_model()


# ──────────────────────────────────────────────────────────────────
# Retry-After header parsing
# ──────────────────────────────────────────────────────────────────

def _parse_retry_after(value: str, default: float) -> float:
    """Parse a Retry-After header value into seconds (supports seconds and HTTP-date)."""
    if not value:
        return default
    try:
        return max(1.0, float(value))
    except ValueError:
        pass
    try:
        retry_at = parsedate_to_datetime(value)
        now = datetime.datetime.now(datetime.timezone.utc)
        return max(1.0, (retry_at - now).total_seconds())
    except Exception:
        return default


# ──────────────────────────────────────────────────────────────────
# Gemini provider
# ──────────────────────────────────────────────────────────────────

def _gemini_endpoint(model: str) -> tuple[str, dict]:
    """Return *(url, headers)* for the Gemini generateContent endpoint."""
    own_key = _env("GEMINI_API_KEY")
    if own_key:
        # Direct Google AI endpoint — uses x-goog-api-key only (Bearer causes 401)
        base    = "https://generativelanguage.googleapis.com/v1beta"
        headers = {"x-goog-api-key": own_key, "Content-Type": "application/json"}
    else:
        base = _env("GEMINI_BASE_URL").rstrip("/")
        if not base:
            raise RuntimeError(
                "Gemini is the configured provider but no credentials were found. "
                "Set GEMINI_API_KEY for direct Google access, or GEMINI_BASE_URL "
                "for a proxy endpoint."
            )
        key = _env("GEMINI_API_KEY", default="dummy")
        headers = {
            "x-goog-api-key":  key,
            "Authorization":   f"Bearer {key}",
            "Content-Type":    "application/json",
        }
    url = f"{base}/models/{model}:generateContent"
    return url, headers


def _call_gemini(
    system_prompt: str,
    user_prompt: str,
    model: str,
    *,
    temperature: float,
    thinking_budget: int,
    retry_attempts: int,
    retry_delay: float,
) -> tuple[str, int, int]:
    """
    Call the Gemini generateContent API.

    Retries on 429 (rate limit), 5xx (transient server error), and network errors.
    Raises immediately on 4xx client errors (except 429).
    Returns *(raw_text, input_tokens, output_tokens)*.
    """
    url, headers = _gemini_endpoint(model)
    body: dict = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature":      temperature,
            "thinkingConfig":   {"thinkingBudget": thinking_budget},
        },
    }
    last_exc: Optional[Exception] = None
    for attempt in range(1, retry_attempts + 1):
        try:
            resp = http.post(url, headers=headers, json=body, timeout=60)
        except Exception as exc:
            # Network-level error (timeout, connection reset, DNS failure, etc.)
            last_exc = exc
            if attempt < retry_attempts:
                time.sleep(retry_delay * attempt)
                continue
            raise RuntimeError(
                f"Gemini: network error after {retry_attempts} attempts: {exc}"
            ) from exc

        if resp.status_code == 429:
            wait = _parse_retry_after(
                resp.headers.get("Retry-After", ""), retry_delay * attempt
            )
            time.sleep(wait)
            continue

        if resp.status_code >= 500:
            # Transient server error — retry with back-off.
            last_exc = RuntimeError(
                f"Gemini: server error {resp.status_code} on attempt {attempt}"
            )
            if attempt < retry_attempts:
                time.sleep(retry_delay * attempt)
                continue
            raise RuntimeError(
                f"Gemini: server error {resp.status_code} after {retry_attempts} attempts"
            )

        resp.raise_for_status()  # 4xx client errors → raise immediately, no retry

        rj    = resp.json()
        usage = rj.get("usageMetadata", {})
        in_tok  = usage.get("promptTokenCount",     0)
        out_tok = usage.get("candidatesTokenCount", 0)
        parts = rj["candidates"][0]["content"]["parts"]
        raw   = next(
            (p["text"] for p in parts if not p.get("thought")),
            parts[-1]["text"],
        )
        return raw, in_tok, out_tok

    raise RuntimeError(
        f"Gemini: exhausted {retry_attempts} retry attempts"
    ) from last_exc


# ──────────────────────────────────────────────────────────────────
# OpenAI provider
# ──────────────────────────────────────────────────────────────────

def _call_openai(
    system_prompt: str,
    user_prompt: str,
    model: str,
    *,
    temperature: float,
    retry_attempts: int,
    retry_delay: float,
) -> tuple[str, int, int]:
    """
    Call an OpenAI-compatible chat completions API.

    Returns *(raw_text, input_tokens, output_tokens)*.
    Raises on permanent failure after all retries.
    """
    from openai import OpenAI  # lazy import — only needed when OpenAI is used

    key      = _env("OPENAI_API_KEY", default="dummy")
    base_url = _env("OPENAI_BASE_URL") or None
    client   = OpenAI(api_key=key, base_url=base_url)

    last_exc: Optional[Exception] = None
    for attempt in range(1, retry_attempts + 1):
        try:
            resp = client.chat.completions.create(
                model=model,
                response_format={"type": "json_object"},
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
            )
            raw     = resp.choices[0].message.content or ""
            in_tok  = resp.usage.prompt_tokens     if resp.usage else 0
            out_tok = resp.usage.completion_tokens if resp.usage else 0
            return raw, in_tok, out_tok
        except Exception as exc:
            last_exc = exc
            if attempt < retry_attempts:
                time.sleep(retry_delay * attempt)
    raise RuntimeError(f"OpenAI: exhausted {retry_attempts} retry attempts") from last_exc


# ──────────────────────────────────────────────────────────────────
# Public interface
# ──────────────────────────────────────────────────────────────────

class LLMError(RuntimeError):
    """Raised when every configured provider fails."""


def call_llm(
    system_prompt: str,
    user_prompt: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.1,
    thinking_budget: int = 0,
    retry_attempts: int = 3,
    retry_delay: float = 2.0,
) -> tuple[str, int, int, str, str]:
    """
    Call the primary LLM and fall back to the secondary on non-retryable failure.

    Parameters
    ----------
    system_prompt   : System / instruction text sent to the model.
    user_prompt     : User message text.
    model           : Override the primary model name (fallback model is unaffected).
    temperature     : Sampling temperature (default 0.1).
    thinking_budget : Gemini thinking-token budget (0 = disabled; ignored for OpenAI).
    retry_attempts  : Max attempts *per provider* before switching to the fallback.
    retry_delay     : Base sleep in seconds between retries (multiplied by attempt number).

    Returns
    -------
    (raw_text, input_tokens, output_tokens, provider_label, model_used)
        raw_text       — raw string response from the model
        input_tokens   — prompt token count (0 if unavailable)
        output_tokens  — completion token count (0 if unavailable)
        provider_label — human-readable label, e.g.
                         "gemini:gemini-2.5-flash-lite" or
                         "openai:gpt-4o-mini (fallback)"
        model_used     — the model name actually called (use this for pricing)

    Raises
    ------
    LLMError — when all providers fail.
    """
    primary_model  = model or PRIMARY_MODEL
    fallback_model = FALLBACK_MODEL

    # Build the ordered list of providers to try.
    providers: list[tuple[str, str, str]] = [
        (PRIMARY_PROVIDER,  primary_model,  ""),
        (FALLBACK_PROVIDER, fallback_model, " (fallback)"),
    ]

    last_exc: Optional[Exception] = None
    for provider, mdl, suffix in providers:
        label = f"{provider}:{mdl}{suffix}"
        try:
            if provider == "gemini":
                raw, in_tok, out_tok = _call_gemini(
                    system_prompt, user_prompt, mdl,
                    temperature=temperature,
                    thinking_budget=thinking_budget,
                    retry_attempts=retry_attempts,
                    retry_delay=retry_delay,
                )
            else:
                raw, in_tok, out_tok = _call_openai(
                    system_prompt, user_prompt, mdl,
                    temperature=temperature,
                    retry_attempts=retry_attempts,
                    retry_delay=retry_delay,
                )
            if suffix:
                print(f"    [llm] Switched to fallback provider ({label})")
            return raw, in_tok, out_tok, label, mdl
        except Exception as exc:
            print(f"    [llm] Provider {label} failed: {exc}")
            last_exc = exc

    raise LLMError(f"All LLM providers failed. Last error: {last_exc}") from last_exc


def check_config() -> None:
    """
    Verify that at least one LLM provider is configured.

    Call this at the top of each script's ``run()`` function (before any
    database work) so users get a clear, actionable error instead of a
    mid-run stack trace.

    Exits with code 1 if no provider credentials are found.
    """
    import sys

    if _gemini_configured() or _openai_configured():
        return  # at least one provider is ready

    print(
        "\n"
        "ERROR: No LLM provider credentials are configured.\n"
        "\n"
        "Set at least ONE of the following environment variables before running:\n"
        "\n"
        "  Gemini (recommended):\n"
        "    GEMINI_API_KEY        — Google AI API key (console.cloud.google.com)\n"
        "    GEMINI_BASE_URL       — proxy base URL for a self-hosted Gemini endpoint\n"
        "\n"
        "  OpenAI (or any OpenAI-compatible API):\n"
        "    OPENAI_API_KEY        — OpenAI API key (platform.openai.com)\n"
        "    OPENAI_BASE_URL       — custom base URL (Azure, local proxy, etc.)\n"
        "\n"
        "Quick start example:\n"
        "    GEMINI_API_KEY=<your-key> python3 extract.py\n"
        "\n"
        "See the README for full configuration instructions.\n",
        file=sys.stderr,
    )
    sys.exit(1)


def print_config() -> None:
    """Print the active LLM configuration to stdout (call once at script startup)."""
    print(
        f"[llm] Primary:  {PRIMARY_PROVIDER} / {PRIMARY_MODEL}\n"
        f"[llm] Fallback: {FALLBACK_PROVIDER} / {FALLBACK_MODEL}"
    )
