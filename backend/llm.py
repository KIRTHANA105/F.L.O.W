"""LLM gateway: one call path with caching, model fallback, and safety mode.

Why this exists (see planner.md section 1): the Gemini free tier allows 20
requests per day *per model*. A rehearsal plus the live demo would blow through
that, and a cold call takes ~57s. So every LLM call goes through llm_call():

  1. Safety mode  -> serve a recorded response, never touch the network
  2. Cache hit    -> serve a stored response, 0 quota, instant
  3. Live call    -> try each model in turn, cache whatever succeeds

The cache is keyed on the prompt, so replaying the same demo sentence is free.
"""
import hashlib
import json
import os
import sqlite3
import time

from google import genai
from google.genai import types

DB_PATH = os.path.join(os.path.dirname(__file__), "llm_cache.db")

# Quota is per model, so a fallback chain multiplies the daily budget.
# Order matters: best model first, cheapest last.
MODEL_CHAIN = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_cache (
    key        TEXT PRIMARY KEY,
    endpoint   TEXT NOT NULL,
    prompt     TEXT NOT NULL,
    response   TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at REAL NOT NULL
);
"""

# Flipped by /api/demo-mode. When on, only cached/recorded answers are served.
_state = {"safety_mode": False}

_client = None

# Observability for the dashboard: proves the cost story on stage.
COUNTERS = {
    "live_calls": 0,      # actually hit the network (spent quota)
    "cache_hits": 0,      # served from cache (free)
    "safety_hits": 0,     # served while safety mode was on
    "fallbacks": 0,       # times we dropped to a lower model
}


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_cache():
    conn = _connect()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def cache_key(endpoint, prompt, system=""):
    raw = f"{endpoint}\x00{system}\x00{prompt}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cache_get(key):
    conn = _connect()
    row = conn.execute("SELECT response FROM llm_cache WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["response"] if row else None


def cache_put(key, endpoint, prompt, response, model):
    conn = _connect()
    conn.execute(
        """INSERT OR REPLACE INTO llm_cache
           (key, endpoint, prompt, response, model, created_at)
           VALUES (?,?,?,?,?,?)""",
        (key, endpoint, prompt, response, model, time.time()),
    )
    conn.commit()
    conn.close()


def cache_stats():
    conn = _connect()
    rows = conn.execute(
        "SELECT endpoint, COUNT(*) AS n FROM llm_cache GROUP BY endpoint"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) AS n FROM llm_cache").fetchone()["n"]
    conn.close()
    return {"total": total, "by_endpoint": {r["endpoint"]: r["n"] for r in rows}}


def set_safety_mode(on):
    _state["safety_mode"] = bool(on)
    return _state["safety_mode"]


def safety_mode():
    return _state["safety_mode"]


def client():
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise LLMError("GEMINI_API_KEY is not set. Add it to backend/.env and restart.")
        _client = genai.Client(api_key=key)
    return _client


class LLMError(Exception):
    """Raised with a message that is safe to show a user mid-demo."""


def _is_quota_error(exc):
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text


def _is_retryable(exc):
    """Quota and transient server errors are worth trying the next model for."""
    text = str(exc)
    return _is_quota_error(exc) or "503" in text or "UNAVAILABLE" in text or "500" in text


def llm_call(endpoint, prompt, system=None, schema=None, max_tokens=2000,
             json_out=True, validate=None, cache_on=None):
    """Single entry point for every LLM call in FLOW.

    `validate` is an optional callable that returns False for an unusable
    response. Anything it rejects is never cached and triggers the next model -
    otherwise one truncated reply would be replayed for the rest of the demo.

    `cache_on` overrides what the cache key is computed from. Use it when the
    prompt contains volatile values (database ids change on every reseed) that
    would otherwise make the same logical request miss the cache every time.

    Returns the raw response text. Raises LLMError with a demo-safe message.
    """
    key = cache_key(endpoint, cache_on if cache_on is not None else prompt, system or "")

    # 1. Safety mode - never touch the network.
    if _state["safety_mode"]:
        cached = cache_get(key)
        if cached is not None:
            COUNTERS["safety_hits"] += 1
            return cached
        raise LLMError(
            "Demo Safety Mode is on and this exact request has not been recorded yet. "
            "Turn Safety Mode off to make a live call, or run this step once to record it."
        )

    # 2. Cache hit - free and instant.
    cached = cache_get(key)
    if cached is not None:
        COUNTERS["cache_hits"] += 1
        return cached

    # 3. Live call, walking the model chain on quota/transient failures.
    config_args = {"max_output_tokens": max_tokens}
    if system:
        config_args["system_instruction"] = system
    if json_out:
        config_args["response_mime_type"] = "application/json"
    if schema:
        config_args["response_schema"] = schema

    last_exc = None
    for index, model in enumerate(MODEL_CHAIN):
        try:
            response = client().models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(**config_args),
            )
            text = (response.text or "").strip()
            if not text:
                raise LLMError("The model returned an empty response.")
            if validate is not None and not validate(text):
                # Truncated/unusable - try the next model rather than cache it.
                # Set and `continue`/`break` instead of raising, so the outer
                # `except LLMError: raise` can't short-circuit the fallback.
                last_exc = LLMError("The model's response was incomplete.")
                if index < len(MODEL_CHAIN) - 1:
                    continue
                break
            if index > 0:
                COUNTERS["fallbacks"] += 1
            COUNTERS["live_calls"] += 1
            cache_put(key, endpoint, prompt, text, model)
            return text
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001 - provider raises bare exceptions
            last_exc = exc
            if _is_retryable(exc) and index < len(MODEL_CHAIN) - 1:
                continue
            break

    if isinstance(last_exc, LLMError):
        raise last_exc
    if last_exc is not None and _is_quota_error(last_exc):
        raise LLMError(
            "Daily free-tier quota is used up on every configured model. "
            "Turn on Demo Safety Mode to run from recorded responses."
        )
    if "API_KEY_INVALID" in str(last_exc) or "API key not valid" in str(last_exc):
        raise LLMError("GEMINI_API_KEY is invalid. Create a new key and update backend/.env.")
    raise LLMError(f"LLM call failed: {last_exc}")


def _is_valid_json(text):
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        return False


def llm_json(endpoint, prompt, system=None, schema=None, max_tokens=2000,
             cache_on=None):
    """llm_call plus JSON parsing. Invalid JSON is never cached."""
    text = llm_call(
        endpoint, prompt, system=system, schema=schema,
        max_tokens=max_tokens, validate=_is_valid_json, cache_on=cache_on,
    )
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise LLMError(
            "The model's response was cut off before it was valid JSON. Try again."
        )


def purge_invalid_json(endpoint):
    """Drop cached entries for `endpoint` that aren't valid JSON."""
    conn = _connect()
    rows = conn.execute(
        "SELECT key, response FROM llm_cache WHERE endpoint=?", (endpoint,)
    ).fetchall()
    bad = [r["key"] for r in rows if not _is_valid_json(r["response"])]
    for key in bad:
        conn.execute("DELETE FROM llm_cache WHERE key=?", (key,))
    conn.commit()
    conn.close()
    return len(bad)
