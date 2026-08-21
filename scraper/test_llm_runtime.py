#!/usr/bin/env python3
"""
Runtime behavior tests for scraper/llm.py and the extraction helpers.

Covers:
  - Primary provider retry exhaustion → fallback is triggered
  - Fallback model token cost is priced correctly (not at primary model rate)
  - parse_response and validate_enums in extract.py

Run with:  python3 -m pytest scraper/test_llm_runtime.py -v
       or: python3 scraper/test_llm_runtime.py
"""

import importlib
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch, call


# ── helpers ──────────────────────────────────────────────────────────────────

SCRAPER_DIR = os.path.dirname(__file__)
if SCRAPER_DIR not in sys.path:
    sys.path.insert(0, SCRAPER_DIR)


def _load_llm(env: dict) -> types.ModuleType:
    """Import (or re-import) llm.py with a specific environment."""
    fake_requests = MagicMock()
    with patch.dict(os.environ, env, clear=True), \
         patch.dict("sys.modules", {"requests": fake_requests}):
        if "llm" in sys.modules:
            del sys.modules["llm"]
        return importlib.import_module("llm")


# ── fallback / retry tests ────────────────────────────────────────────────────

class TestFallbackTriggering(unittest.TestCase):
    """call_llm falls back to the secondary provider when the primary exhausts retries."""

    def _make_llm(self, env: dict):
        return _load_llm(env)

    def test_gemini_failure_triggers_openai_fallback(self):
        """When Gemini raises on every attempt, OpenAI is called and succeeds."""
        m = self._make_llm({"GEMINI_API_KEY": "gkey", "OPENAI_API_KEY": "okey"})

        # Gemini inner call always raises
        gemini_exc = RuntimeError("Gemini server error 503 after 3 attempts")
        openai_result = ('{"ok": true}', 10, 5)

        with patch.object(m, "_call_gemini", side_effect=gemini_exc) as mock_gem, \
             patch.object(m, "_call_openai", return_value=openai_result) as mock_oai:
            raw, in_tok, out_tok, label, model_used = m.call_llm(
                "sys", "user", retry_attempts=3, retry_delay=0
            )

        mock_gem.assert_called_once()
        mock_oai.assert_called_once()
        self.assertIn("fallback", label)
        self.assertEqual(raw, '{"ok": true}')
        self.assertEqual(model_used, m.FALLBACK_MODEL)

    def test_openai_failure_triggers_gemini_fallback(self):
        """When OpenAI is primary and raises, Gemini fallback is called."""
        m = self._make_llm({
            "OPENAI_API_KEY":       "okey",
            "GEMINI_API_KEY":       "gkey",
            "LLM_PRIMARY_PROVIDER": "openai",
        })

        openai_exc = RuntimeError("OpenAI: exhausted 3 retry attempts")
        gemini_result = ('{"ok": true}', 20, 8)

        with patch.object(m, "_call_openai", side_effect=openai_exc), \
             patch.object(m, "_call_gemini", return_value=gemini_result) as mock_gem:
            raw, in_tok, out_tok, label, model_used = m.call_llm(
                "sys", "user", retry_attempts=3, retry_delay=0
            )

        mock_gem.assert_called_once()
        self.assertIn("fallback", label)
        self.assertEqual(model_used, m.FALLBACK_MODEL)

    def test_both_providers_fail_raises_llm_error(self):
        """LLMError is raised when every provider fails."""
        m = self._make_llm({"GEMINI_API_KEY": "gkey"})

        with patch.object(m, "_call_gemini", side_effect=RuntimeError("gemini fail")), \
             patch.object(m, "_call_openai", side_effect=RuntimeError("openai fail")):
            with self.assertRaises(m.LLMError):
                m.call_llm("sys", "user", retry_attempts=1, retry_delay=0)

    def test_primary_success_does_not_call_fallback(self):
        """No fallback call when the primary succeeds on the first attempt."""
        m = self._make_llm({"GEMINI_API_KEY": "gkey"})
        primary_result = ('{"result": 1}', 100, 50)

        with patch.object(m, "_call_gemini", return_value=primary_result) as mock_gem, \
             patch.object(m, "_call_openai") as mock_oai:
            m.call_llm("sys", "user")

        mock_gem.assert_called_once()
        mock_oai.assert_not_called()

    def test_model_used_is_fallback_model_on_fallback(self):
        """model_used in the return tuple is the fallback model, not the primary."""
        m = self._make_llm({"GEMINI_API_KEY": "gkey", "OPENAI_API_KEY": "okey"})
        expected_fallback_model = m.FALLBACK_MODEL

        with patch.object(m, "_call_gemini", side_effect=RuntimeError("fail")), \
             patch.object(m, "_call_openai", return_value=('{}', 1, 1)):
            _raw, _in, _out, _label, model_used = m.call_llm(
                "sys", "user", retry_attempts=1, retry_delay=0
            )

        self.assertEqual(model_used, expected_fallback_model)


# ── token cost accounting tests ───────────────────────────────────────────────

class TestFallbackTokenCostAccounting(unittest.TestCase):
    """
    Cost must be computed using the model that actually responded, not PRIMARY_MODEL.

    In the default Gemini-primary / OpenAI-fallback configuration:
      - Gemini Flash Lite: $0.10 input / $0.40 output per 1M tokens
      - GPT-4o-mini:       $0.15 input / $0.60 output per 1M tokens

    If primary fails and the fallback model has different pricing, the accumulated
    cost must reflect the fallback model's rates, not the primary's.
    """

    def _setup(self):
        return _load_llm({"GEMINI_API_KEY": "gkey", "OPENAI_API_KEY": "okey"})

    def test_primary_call_priced_at_primary_model_rate(self):
        m = self._setup()
        in_tok, out_tok = 1_000_000, 1_000_000   # 1M each for easy math
        primary_result  = ('{}', in_tok, out_tok)

        with patch.object(m, "_call_gemini", return_value=primary_result):
            _raw, ret_in, ret_out, _label, model_used = m.call_llm("s", "u")

        inp_rate, out_rate = m.get_pricing(model_used)
        expected_cost = (ret_in / 1_000_000 * inp_rate) + (ret_out / 1_000_000 * out_rate)

        # Gemini Flash Lite: 0.10 + 0.40 = $0.50
        self.assertAlmostEqual(expected_cost, 0.50, places=6)
        self.assertEqual(model_used, m.PRIMARY_MODEL)

    def test_fallback_call_priced_at_fallback_model_rate(self):
        """Cost computed from model_used (fallback) ≠ cost from PRIMARY_MODEL."""
        m = self._setup()
        in_tok, out_tok   = 1_000_000, 1_000_000
        fallback_result   = ('{}', in_tok, out_tok)

        with patch.object(m, "_call_gemini", side_effect=RuntimeError("fail")), \
             patch.object(m, "_call_openai", return_value=fallback_result):
            _raw, ret_in, ret_out, _label, model_used = m.call_llm(
                "s", "u", retry_attempts=1, retry_delay=0
            )

        # model_used should be the fallback model
        self.assertEqual(model_used, m.FALLBACK_MODEL)

        inp_rate, out_rate = m.get_pricing(model_used)
        actual_cost = (ret_in / 1_000_000 * inp_rate) + (ret_out / 1_000_000 * out_rate)

        primary_inp, primary_out = m.get_pricing(m.PRIMARY_MODEL)
        wrong_cost = (ret_in / 1_000_000 * primary_inp) + (ret_out / 1_000_000 * primary_out)

        # Verify pricing differs (catches the bug where PRIMARY_MODEL was always used)
        self.assertNotAlmostEqual(actual_cost, wrong_cost, places=6,
            msg="Fallback model pricing must differ from primary model pricing")

        # GPT-4o-mini: $0.15 + $0.60 = $0.75
        self.assertAlmostEqual(actual_cost, 0.75, places=6)


# ── extract.py parse_response / validate_enums ────────────────────────────────

class TestParseResponse(unittest.TestCase):
    """parse_response and validate_enums handle edge cases correctly."""

    def setUp(self):
        # Load extract.py with a mocked llm so the import doesn't need real creds.
        fake_requests = MagicMock()
        fake_llm = MagicMock()
        fake_pgdb = MagicMock()
        fake_judgements = MagicMock()
        fake_judgements.clean_html = lambda x: x
        with patch.dict("sys.modules", {
            "requests":  fake_requests,
            "llm":       fake_llm,
            "pgdb":      fake_pgdb,
            "judgements": fake_judgements,
        }):
            if "extract" in sys.modules:
                del sys.modules["extract"]
            self.extract = importlib.import_module("extract")

    def test_valid_json_parsed(self):
        result = self.extract.parse_response(
            '{"issue_type":"Vehicle Defect","outcome":"Allowed","confidence":0.9,'
            '"sales_or_service":"Service","part_category":"Engine / Transmission",'
            '"warranty_related":true,"is_ev":false,"grounds_taken":["a"]}'
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["issue_type"], "Vehicle Defect")
        self.assertEqual(result["outcome"], "Allowed")
        self.assertAlmostEqual(result["confidence"], 0.9)

    def test_invalid_enum_nulled(self):
        result = self.extract.parse_response(
            '{"issue_type":"Made-up Type","outcome":"Allowed","confidence":0.8}'
        )
        self.assertIsNotNone(result)
        self.assertIsNone(result["issue_type"],
            "Invalid issue_type should be set to None")

    def test_markdown_fences_stripped(self):
        result = self.extract.parse_response(
            '```json\n{"issue_type":"Other","confidence":0.5}\n```'
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["issue_type"], "Other")

    def test_non_json_returns_none(self):
        result = self.extract.parse_response("Sorry, I cannot help with that.")
        self.assertIsNone(result)

    def test_empty_string_returns_none(self):
        result = self.extract.parse_response("")
        self.assertIsNone(result)

    def test_grounds_taken_non_list_nulled(self):
        result = self.extract.parse_response(
            '{"issue_type":"Other","confidence":0.5,"grounds_taken":"single string"}'
        )
        self.assertIsNotNone(result)
        self.assertIsNone(result["grounds_taken"])

    def test_confidence_coerced_to_float(self):
        result = self.extract.parse_response(
            '{"issue_type":"Other","confidence":"0.75"}'
        )
        self.assertIsNotNone(result)
        self.assertIsInstance(result["confidence"], float)
        self.assertAlmostEqual(result["confidence"], 0.75)


if __name__ == "__main__":
    unittest.main(verbosity=2)
