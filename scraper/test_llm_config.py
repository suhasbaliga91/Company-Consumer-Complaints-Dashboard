#!/usr/bin/env python3
"""
Tests for scraper/llm.py configuration routing.

Covers:
  - Canonical Gemini-only setup
  - Canonical OpenAI-only setup
  - Explicitly set provider + model
  - Fallback provider/model defaults
  - Provider-appropriate model defaults (no model override)
  - Legacy EXTRACT_MODEL / OPENAI_EXTRACT_MODEL aliases

Run with:  python3 -m pytest scraper/test_llm_config.py -v
       or: python3 scraper/test_llm_config.py
"""

import importlib
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


def _load_llm(env: dict) -> types.ModuleType:
    """
    Import (or re-import) scraper/llm.py with a specific environment.
    Module-level constants are evaluated at import time, so we must reload
    with the desired env vars active.
    """
    # Add scraper/ to path so the bare `import llm` works.
    scraper_dir = os.path.join(os.path.dirname(__file__))
    if scraper_dir not in sys.path:
        sys.path.insert(0, scraper_dir)

    # Patch requests so the module doesn't try real HTTP on import.
    fake_requests = MagicMock()
    with patch.dict(os.environ, env, clear=True), \
         patch.dict("sys.modules", {"requests": fake_requests}):
        if "llm" in sys.modules:
            del sys.modules["llm"]
        mod = importlib.import_module("llm")
    return mod


class TestProviderModelDefaults(unittest.TestCase):
    """Provider and model resolve to sensible defaults based on credentials."""

    def test_gemini_key_selects_gemini_primary_with_gemini_model(self):
        m = _load_llm({"GEMINI_API_KEY": "gkey"})
        self.assertEqual(m.PRIMARY_PROVIDER, "gemini")
        self.assertEqual(m.PRIMARY_MODEL, "gemini-2.5-flash-lite")
        self.assertEqual(m.FALLBACK_PROVIDER, "openai")
        self.assertEqual(m.FALLBACK_MODEL, "gpt-4o-mini")

    def test_openai_key_only_selects_openai_primary_with_openai_model(self):
        """Critical: OpenAI-only config must not default to a Gemini model name."""
        m = _load_llm({"OPENAI_API_KEY": "okey"})
        self.assertEqual(m.PRIMARY_PROVIDER, "openai")
        self.assertEqual(m.PRIMARY_MODEL, "gpt-4o-mini")
        self.assertEqual(m.FALLBACK_PROVIDER, "gemini")
        self.assertEqual(m.FALLBACK_MODEL, "gemini-2.5-flash-lite")

    def test_both_keys_prefers_gemini_as_primary(self):
        m = _load_llm({"GEMINI_API_KEY": "gkey", "OPENAI_API_KEY": "okey"})
        self.assertEqual(m.PRIMARY_PROVIDER, "gemini")
        self.assertEqual(m.FALLBACK_PROVIDER, "openai")

    def test_no_credentials_defaults_to_gemini(self):
        m = _load_llm({})
        self.assertEqual(m.PRIMARY_PROVIDER, "gemini")
        self.assertEqual(m.PRIMARY_MODEL, "gemini-2.5-flash-lite")


class TestExplicitOverrides(unittest.TestCase):
    """Canonical LLM_* vars override auto-detection."""

    def test_explicit_openai_primary_with_gemini_key(self):
        """Explicit provider wins over auto-detected Gemini."""
        m = _load_llm({
            "GEMINI_API_KEY":       "gkey",
            "LLM_PRIMARY_PROVIDER": "openai",
        })
        self.assertEqual(m.PRIMARY_PROVIDER, "openai")
        self.assertEqual(m.PRIMARY_MODEL, "gpt-4o-mini")  # openai default

    def test_explicit_model_overrides_default(self):
        m = _load_llm({
            "GEMINI_API_KEY":     "gkey",
            "LLM_PRIMARY_MODEL":  "gemini-2.5-flash",
        })
        self.assertEqual(m.PRIMARY_MODEL, "gemini-2.5-flash")

    def test_explicit_fallback_provider_and_model(self):
        m = _load_llm({
            "OPENAI_API_KEY":        "okey",
            "LLM_FALLBACK_PROVIDER": "gemini",
            "LLM_FALLBACK_MODEL":    "gemini-2.5-flash",
        })
        self.assertEqual(m.FALLBACK_PROVIDER, "gemini")
        self.assertEqual(m.FALLBACK_MODEL, "gemini-2.5-flash")

    def test_explicit_canonical_vars_take_precedence_over_legacy(self):
        """LLM_PRIMARY_MODEL wins over EXTRACT_MODEL when both are set."""
        m = _load_llm({
            "GEMINI_API_KEY":    "gkey",
            "LLM_PRIMARY_MODEL": "gemini-2.5-flash",
            "EXTRACT_MODEL":     "gemini-2.5-flash-lite",
        })
        self.assertEqual(m.PRIMARY_MODEL, "gemini-2.5-flash")

    def test_gemini_base_url_canonical_name(self):
        """GEMINI_BASE_URL (canonical) is recognised as Gemini credentials."""
        m = _load_llm({"GEMINI_BASE_URL": "https://my-proxy.example.com"})
        self.assertEqual(m.PRIMARY_PROVIDER, "gemini")

    def test_legacy_extract_model_overrides_primary_model(self):
        """EXTRACT_MODEL (legacy alias) still sets the primary model."""
        m = _load_llm({
            "GEMINI_API_KEY": "gkey",
            "EXTRACT_MODEL":  "gemini-2.5-flash",
        })
        self.assertEqual(m.PRIMARY_MODEL, "gemini-2.5-flash")

    def test_legacy_openai_extract_model_overrides_fallback_model(self):
        """OPENAI_EXTRACT_MODEL (legacy alias) still sets the fallback model."""
        m = _load_llm({
            "GEMINI_API_KEY":       "gkey",
            "OPENAI_EXTRACT_MODEL": "gpt-4o",
        })
        self.assertEqual(m.FALLBACK_MODEL, "gpt-4o")


class TestGetPricing(unittest.TestCase):
    """get_pricing returns correct rates and falls back for unknown models."""

    def setUp(self):
        self.m = _load_llm({"GEMINI_API_KEY": "gkey"})

    def test_known_model_rates(self):
        inp, out = self.m.get_pricing("gemini-2.5-flash-lite")
        self.assertAlmostEqual(inp, 0.10)
        self.assertAlmostEqual(out, 0.40)

    def test_unknown_model_returns_default(self):
        inp, out = self.m.get_pricing("some-future-model")
        self.assertAlmostEqual(inp, 0.10)
        self.assertAlmostEqual(out, 0.40)


if __name__ == "__main__":
    unittest.main(verbosity=2)
