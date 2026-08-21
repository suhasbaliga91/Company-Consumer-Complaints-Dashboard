#!/usr/bin/env python3
"""
Regression tests for the LLM extraction pipeline.

Covers:
  - parse_response: valid JSON, markdown-fenced JSON, embedded JSON, invalid text
  - validate_enums: allowed / disallowed values, type coercion, boolean coercion
  - extract_case: token accumulation via a mocked call_llm
  - extract_dealer: respondent extraction via a mocked call_llm

No live LLM calls are made — llm.call_llm is monkey-patched throughout.
Run with:
    python3 -m pytest scraper/test_extract.py   (from project root)
    python3 -m pytest test_extract.py           (from scraper/)
"""

import importlib
import json
import sys
import os
import types

import pytest

# ---------------------------------------------------------------------------
# Ensure the scraper directory is on sys.path so we can import its modules
# without installing them as a package.
# ---------------------------------------------------------------------------
# Also add the fixtures package sitting alongside this file.
# ---------------------------------------------------------------------------

SCRAPER_DIR = os.path.dirname(os.path.abspath(__file__))
for _p in (SCRAPER_DIR, os.path.join(SCRAPER_DIR, "fixtures")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ---------------------------------------------------------------------------
# Stub out heavy / side-effect-producing imports before loading extract.py.
# We replace `pgdb`, `judgements`, and keep `llm` importable but patchable.
# ---------------------------------------------------------------------------

def _make_stub(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


# pgdb stub — no database access needed
pgdb_stub = _make_stub("pgdb")
pgdb_stub.get_connection = lambda: None
pgdb_stub.get_thread_connection = lambda: None

# judgements stub — clean_html just strips tags
judgements_stub = _make_stub("judgements")
judgements_stub.clean_html = lambda html: html  # identity for tests

# Now import the real modules (llm first so extract can import it)
import llm  # noqa: E402  (must be after stub setup)
import extract  # noqa: E402
import extract_respondents  # noqa: E402
from fixtures.judgment_corpus import CORPUS  # noqa: E402
from fixtures.real_corpus import REAL_CORPUS  # noqa: E402


# ===========================================================================
# Helpers
# ===========================================================================

VALID_JSON_PAYLOAD = {
    "issue_type": "Vehicle Defect",
    "sales_or_service": "Sales",
    "warranty_related": True,
    "product_model": "ExampleCo Nexon EV",
    "is_ev": True,
    "part_involved": "Battery",
    "part_category": "Electrical / AC",
    "dealership": "XYZ Motors",
    "outcome": "Partially Allowed",
    "claim_amount": 1500000,
    "amount_awarded": 850000,
    "grounds_taken": ["Defective battery", "Failure to repair"],
    "confidence": 0.92,
    "source_snippet": "directed OP to refund Rs.8,50,000",
}


# ===========================================================================
# parse_response tests
# ===========================================================================

class TestParseResponse:
    """Unit tests for extract.parse_response."""

    def test_plain_valid_json(self):
        raw = json.dumps(VALID_JSON_PAYLOAD)
        result = extract.parse_response(raw)
        assert result is not None
        assert result["issue_type"] == "Vehicle Defect"
        assert result["outcome"] == "Partially Allowed"
        assert result["confidence"] == pytest.approx(0.92)

    def test_markdown_fenced_json(self):
        raw = "```json\n" + json.dumps(VALID_JSON_PAYLOAD) + "\n```"
        result = extract.parse_response(raw)
        assert result is not None
        assert result["product_model"] == "ExampleCo Nexon EV"

    def test_markdown_fenced_no_language_tag(self):
        raw = "```\n" + json.dumps(VALID_JSON_PAYLOAD) + "\n```"
        result = extract.parse_response(raw)
        assert result is not None
        assert result["is_ev"] is True

    def test_json_embedded_in_prose(self):
        """LLM occasionally wraps JSON in prose — we should still extract it."""
        payload = json.dumps({"issue_type": "Service Deficiency", "confidence": 0.8})
        raw = f"Here is the result:\n{payload}\nThank you."
        result = extract.parse_response(raw)
        assert result is not None
        assert result["issue_type"] == "Service Deficiency"

    def test_returns_none_for_empty_string(self):
        assert extract.parse_response("") is None

    def test_returns_none_for_pure_text(self):
        assert extract.parse_response("No JSON here at all.") is None

    def test_returns_none_for_malformed_json(self):
        assert extract.parse_response("{this is not valid json}") is None

    def test_returns_none_for_json_array(self):
        """Top-level array is not a dict — should be rejected."""
        assert extract.parse_response("[1, 2, 3]") is None

    def test_whitespace_trimmed(self):
        raw = "   " + json.dumps(VALID_JSON_PAYLOAD) + "   "
        result = extract.parse_response(raw)
        assert result is not None

    def test_confidence_as_string_is_coerced(self):
        payload = {**VALID_JSON_PAYLOAD, "confidence": "0.75"}
        result = extract.parse_response(json.dumps(payload))
        assert result is not None
        assert result["confidence"] == pytest.approx(0.75)

    def test_null_fields_preserved(self):
        payload = {**VALID_JSON_PAYLOAD, "dealership": None, "part_involved": None}
        result = extract.parse_response(json.dumps(payload))
        assert result is not None
        assert result["dealership"] is None


# ===========================================================================
# validate_enums tests
# ===========================================================================

class TestValidateEnums:
    """Unit tests for extract.validate_enums."""

    def _base(self) -> dict:
        return {
            "issue_type": "Vehicle Defect",
            "outcome": "Allowed",
            "sales_or_service": "Sales",
            "part_category": "Engine / Transmission",
            "confidence": 0.9,
            "claim_amount": 100000.0,
            "amount_awarded": 50000.0,
            "warranty_related": True,
            "is_ev": False,
            "grounds_taken": ["ground 1"],
        }

    # ---- enum acceptance ----

    def test_valid_issue_type_accepted(self):
        d = extract.validate_enums(self._base())
        assert d["issue_type"] == "Vehicle Defect"

    def test_invalid_issue_type_nulled(self):
        b = self._base()
        b["issue_type"] = "Unknown Category"
        d = extract.validate_enums(b)
        assert d["issue_type"] is None

    def test_valid_outcome_accepted(self):
        d = extract.validate_enums(self._base())
        assert d["outcome"] == "Allowed"

    def test_invalid_outcome_nulled(self):
        b = self._base()
        b["outcome"] = "Won"
        d = extract.validate_enums(b)
        assert d["outcome"] is None

    def test_valid_sales_or_service_sales(self):
        d = extract.validate_enums(self._base())
        assert d["sales_or_service"] == "Sales"

    def test_valid_sales_or_service_service(self):
        b = self._base()
        b["sales_or_service"] = "Service"
        d = extract.validate_enums(b)
        assert d["sales_or_service"] == "Service"

    def test_invalid_sales_or_service_nulled(self):
        b = self._base()
        b["sales_or_service"] = "Both"
        d = extract.validate_enums(b)
        assert d["sales_or_service"] is None

    def test_valid_part_category_accepted(self):
        d = extract.validate_enums(self._base())
        assert d["part_category"] == "Engine / Transmission"

    def test_invalid_part_category_nulled(self):
        b = self._base()
        b["part_category"] = "Tyres"
        d = extract.validate_enums(b)
        assert d["part_category"] is None

    # ---- numeric coercion ----

    def test_confidence_float_preserved(self):
        d = extract.validate_enums(self._base())
        assert d["confidence"] == pytest.approx(0.9)

    def test_confidence_string_coerced(self):
        b = self._base()
        b["confidence"] = "0.85"
        d = extract.validate_enums(b)
        assert d["confidence"] == pytest.approx(0.85)

    def test_confidence_bad_string_nulled(self):
        b = self._base()
        b["confidence"] = "high"
        d = extract.validate_enums(b)
        assert d["confidence"] is None

    def test_claim_amount_string_coerced(self):
        b = self._base()
        b["claim_amount"] = "200000"
        d = extract.validate_enums(b)
        assert d["claim_amount"] == pytest.approx(200000.0)

    def test_amount_awarded_none_preserved(self):
        b = self._base()
        b["amount_awarded"] = None
        d = extract.validate_enums(b)
        assert d["amount_awarded"] is None

    # ---- boolean coercion ----

    def test_warranty_related_bool_true(self):
        d = extract.validate_enums(self._base())
        assert d["warranty_related"] is True

    def test_warranty_related_bool_false(self):
        b = self._base()
        b["warranty_related"] = False
        d = extract.validate_enums(b)
        assert d["warranty_related"] is False

    def test_warranty_related_string_true(self):
        b = self._base()
        b["warranty_related"] = "true"
        d = extract.validate_enums(b)
        assert d["warranty_related"] is True

    def test_warranty_related_string_yes(self):
        b = self._base()
        b["warranty_related"] = "yes"
        d = extract.validate_enums(b)
        assert d["warranty_related"] is True

    def test_warranty_related_string_false(self):
        b = self._base()
        b["warranty_related"] = "false"
        d = extract.validate_enums(b)
        assert d["warranty_related"] is False

    def test_is_ev_string_1_truthy(self):
        b = self._base()
        b["is_ev"] = "1"
        d = extract.validate_enums(b)
        assert d["is_ev"] is True

    def test_is_ev_none_preserved(self):
        b = self._base()
        b["is_ev"] = None
        d = extract.validate_enums(b)
        assert d["is_ev"] is None

    # ---- grounds_taken ----

    def test_grounds_taken_list_preserved(self):
        d = extract.validate_enums(self._base())
        assert d["grounds_taken"] == ["ground 1"]

    def test_grounds_taken_none_preserved(self):
        b = self._base()
        b["grounds_taken"] = None
        d = extract.validate_enums(b)
        assert d["grounds_taken"] is None

    def test_grounds_taken_non_list_nulled(self):
        b = self._base()
        b["grounds_taken"] = "single ground"
        d = extract.validate_enums(b)
        assert d["grounds_taken"] is None

    # ---- all valid enum members accepted ----

    @pytest.mark.parametrize("issue_type", sorted(extract.VALID_ISSUE_TYPES))
    def test_all_valid_issue_types(self, issue_type):
        b = self._base()
        b["issue_type"] = issue_type
        d = extract.validate_enums(b)
        assert d["issue_type"] == issue_type

    @pytest.mark.parametrize("outcome", sorted(extract.VALID_OUTCOME_VALUES))
    def test_all_valid_outcomes(self, outcome):
        b = self._base()
        b["outcome"] = outcome
        d = extract.validate_enums(b)
        assert d["outcome"] == outcome

    @pytest.mark.parametrize("part_cat", sorted(extract.VALID_PART_CATEGORIES))
    def test_all_valid_part_categories(self, part_cat):
        b = self._base()
        b["part_category"] = part_cat
        d = extract.validate_enums(b)
        assert d["part_category"] == part_cat


# ===========================================================================
# extract_case: token accumulation with mocked call_llm
# ===========================================================================

class TestExtractCaseTokenAccumulation:
    """
    Verify that extract_case correctly accumulates token counts via _add_tokens
    by monkey-patching llm.call_llm.
    """

    def _make_llm_response(self, payload: dict, in_tok: int, out_tok: int):
        """Return a callable that mimics llm.call_llm with given token counts."""
        raw = json.dumps(payload)

        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            return raw, in_tok, out_tok, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        return _fake_call_llm

    def test_tokens_accumulated_single_call(self, monkeypatch):
        """A single successful extraction should accumulate the expected tokens."""
        payload = {**VALID_JSON_PAYLOAD}
        monkeypatch.setattr(llm, "call_llm", self._make_llm_response(payload, 1234, 567))

        # Reset module-level counters
        extract._token_input  = 0
        extract._token_output = 0
        extract._run_cost_usd = 0.0

        result = extract.extract_case("Some judgment text")

        assert result is not None
        assert result["issue_type"] == "Vehicle Defect"
        assert extract._token_input  == 1234
        assert extract._token_output == 567

    def test_tokens_accumulated_across_multiple_calls(self, monkeypatch):
        """Token counts should be additive across successive extract_case calls."""
        payload = {**VALID_JSON_PAYLOAD}
        call_count = 0

        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            nonlocal call_count
            call_count += 1
            return json.dumps(payload), 100, 50, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _fake_call_llm)

        extract._token_input  = 0
        extract._token_output = 0
        extract._run_cost_usd = 0.0

        extract.extract_case("First judgment")
        extract.extract_case("Second judgment")

        assert call_count == 2
        assert extract._token_input  == 200
        assert extract._token_output == 100

    def test_extract_case_returns_none_on_llm_error(self, monkeypatch):
        """When call_llm raises LLMError, extract_case should return None."""
        def _always_fail(system_prompt, user_prompt, **kwargs):
            raise llm.LLMError("all providers failed")

        monkeypatch.setattr(llm, "call_llm", _always_fail)

        result = extract.extract_case("Some judgment text")
        assert result is None

    def test_extract_case_retries_on_bad_parse(self, monkeypatch):
        """
        When call_llm returns unparseable text, extract_case retries up to 3 times
        and ultimately returns None.
        """
        call_count = 0

        def _bad_response(system_prompt, user_prompt, **kwargs):
            nonlocal call_count
            call_count += 1
            return "not json at all", 10, 5, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _bad_response)
        # Patch sleep so the test doesn't wait 6+ seconds
        monkeypatch.setattr("extract.time.sleep", lambda _: None)

        result = extract.extract_case("Some judgment text")

        assert result is None
        assert call_count == 3  # extract_case retries up to 3 times

    def test_extract_case_low_confidence_classification(self, monkeypatch):
        """
        parse_response for a low-confidence payload should still succeed;
        the 'low_confidence' status decision happens in the caller (process_one),
        not in extract_case itself — verify confidence field is returned correctly.
        """
        payload = {**VALID_JSON_PAYLOAD, "confidence": 0.20}
        monkeypatch.setattr(llm, "call_llm", self._make_llm_response(payload, 100, 40))

        result = extract.extract_case("Short judgment")
        assert result is not None
        assert result["confidence"] == pytest.approx(0.20)


# ===========================================================================
# extract_dealer: token accumulation with mocked call_llm
# ===========================================================================

class TestExtractDealerTokenAccumulation:
    """Verify extract_respondents.extract_dealer accumulates tokens correctly."""

    def test_tokens_accumulated_on_success(self, monkeypatch):
        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            payload = {"dealership_canonical": "Concorde Motors"}
            return json.dumps(payload), 80, 20, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _fake_call_llm)

        extract_respondents._token_input  = 0
        extract_respondents._token_output = 0
        extract_respondents._run_cost_usd = 0.0

        result = extract_respondents.extract_dealer("ExampleCo Ltd, Concorde Motors, Pune")
        assert result == "Concorde Motors"
        assert extract_respondents._token_input  == 80
        assert extract_respondents._token_output == 20

    def test_oem_only_respondent_returns_none(self, monkeypatch):
        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            payload = {"dealership_canonical": None}
            return json.dumps(payload), 50, 15, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _fake_call_llm)

        result = extract_respondents.extract_dealer("EXAMPLECO LIMITED & ANR")
        assert result is None

    def test_returns_none_on_llm_error(self, monkeypatch):
        def _always_fail(system_prompt, user_prompt, **kwargs):
            raise llm.LLMError("all providers failed")

        monkeypatch.setattr(llm, "call_llm", _always_fail)

        result = extract_respondents.extract_dealer("Some Dealer Pvt Ltd")
        assert result is None

    def test_short_dealer_name_filtered(self, monkeypatch):
        """Dealer names shorter than 5 chars should be filtered out."""
        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            payload = {"dealership_canonical": "AB"}
            return json.dumps(payload), 50, 15, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _fake_call_llm)

        result = extract_respondents.extract_dealer("AB Pvt Ltd")
        assert result is None

    def test_dealer_with_oem_name_filtered(self, monkeypatch):
        """Dealer names matching the configured OEM name should be filtered out."""
        import re
        # Patch OEM_PATTERN directly since it is resolved at module import time
        monkeypatch.setattr(
            extract_respondents, "OEM_PATTERN",
            re.compile(r"\bAcme Motors\b", re.IGNORECASE),
        )

        def _fake_call_llm(system_prompt, user_prompt, **kwargs):
            payload = {"dealership_canonical": "Acme Motors Dealer"}
            return json.dumps(payload), 50, 15, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _fake_call_llm)

        result = extract_respondents.extract_dealer("Acme Motors Dealer Pvt Ltd")
        assert result is None


# ===========================================================================
# CONFIDENCE_THRESHOLD constant
# ===========================================================================

class TestConstants:
    def test_confidence_threshold_value(self):
        assert extract.CONFIDENCE_THRESHOLD == pytest.approx(0.35)

    def test_max_text_chars_positive(self):
        assert extract.MAX_TEXT_CHARS > 0


# ===========================================================================
# Realistic classification corpus — golden-file regression tests
#
# Architecture:
#   fixtures/judgment_corpus.py   — judgment_text + truth_labels
#                                   truth_labels are HUMAN-AUTHORED by reading
#                                   the judgment text; they are independent of
#                                   any LLM response.
#
#   fixtures/recordings/<id>.json — one file per corpus entry, containing the
#                                   raw LLM response string captured by running
#                                   fixtures/record.py against the real pipeline,
#                                   then human-reviewed for agreement with the
#                                   truth labels.
#
# The tests below:
#   1. Load raw_llm_response from the recording file on disk.
#   2. Feed it through parse_response + validate_enums (the real pipeline).
#   3. Assert every truth_label field matches the parsed result.
#
# A regression shows up as a test failure when:
#   - A prompt change makes the LLM return different classifications
#     (regenerate recordings → they differ from truth_labels → tests fail).
#   - A parsing / enum-validation bug distorts a valid recording into wrong fields.
#   - A recording is updated to something that no longer matches the human labels.
#
# Run fixtures/record.py to regenerate recordings after a prompt or model change;
# always review the output against truth_labels before committing.
# ===========================================================================

RECORDINGS_DIR = os.path.join(SCRAPER_DIR, "fixtures", "recordings")


def _load_recording(case_id: str) -> str:
    """Load and return the raw LLM response string from a golden recording file."""
    path = os.path.join(RECORDINGS_DIR, f"{case_id}.json")
    with open(path, encoding="utf-8") as fh:
        record = json.load(fh)
    return record["raw_llm_response"]


def _corpus_ids():
    return [entry["id"] for entry in CORPUS]


def _corpus_params():
    return CORPUS


class TestRealisticClassification:
    """
    Golden-file classification regression tests.

    Each test loads the pre-recorded LLM response from disk (fixtures/recordings/),
    runs it through the real parse_response → validate_enums pipeline, and asserts
    the result matches the independently-authored truth_labels in judgment_corpus.py.

    No live LLM calls are made; call_llm is mocked to return the on-disk recording.
    """

    @pytest.mark.parametrize("entry", _corpus_params(), ids=_corpus_ids())
    def test_recording_file_exists(self, entry):
        """Every corpus entry must have a corresponding recording file on disk."""
        path = os.path.join(RECORDINGS_DIR, f"{entry['id']}.json")
        assert os.path.exists(path), (
            f"Missing recording: {path}\n"
            "Run `python3 fixtures/record.py` to generate it."
        )

    @pytest.mark.parametrize("entry", _corpus_params(), ids=_corpus_ids())
    def test_recording_parses_to_valid_dict(self, entry):
        """
        The raw LLM response in each recording file must parse to a non-None dict
        via the real parse_response pipeline.  A failure means the recording itself
        is malformed or the parser has regressed.
        """
        raw = _load_recording(entry["id"])
        result = extract.parse_response(raw)
        assert result is not None, (
            f"[{entry['id']}] parse_response returned None.\n"
            f"Recording raw (first 200 chars): {raw[:200]!r}"
        )

    @pytest.mark.parametrize("entry", _corpus_params(), ids=_corpus_ids())
    def test_recording_matches_truth_labels(self, entry, monkeypatch):
        """
        Core regression test: the on-disk recording, fed through the full
        extract_case pipeline (call_llm mocked to return the recording), must
        produce fields that agree with the human-authored truth_labels.

        A failure here means EITHER:
          (a) the recording was regenerated after a prompt/model change that
              altered the LLM's classification — update truth_labels if the new
              classification is correct, or fix the prompt if it is not; OR
          (b) a parsing/enum-validation bug distorted a valid recording —
              fix extract.parse_response / validate_enums.
        """
        raw = _load_recording(entry["id"])

        def _mock_call_llm(system_prompt, user_prompt, **kwargs):
            return raw, 500, 120, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _mock_call_llm)

        result = extract.extract_case(entry["judgment_text"])
        assert result is not None, (
            f"[{entry['id']}] extract_case returned None — pipeline failed to parse recording"
        )

        truth = entry["truth_labels"]
        case_id = entry["id"]

        # --- categorical fields: exact match ---
        for field in (
            "issue_type", "sales_or_service", "outcome",
            "product_model", "part_involved", "part_category",
            "dealership", "is_ev", "warranty_related",
        ):
            if field in truth:
                assert result.get(field) == truth[field], (
                    f"[{case_id}] {field}: recording produced {result.get(field)!r}, "
                    f"truth_label says {truth[field]!r}.\n"
                    f"If the LLM classification changed, re-review truth_labels."
                )

        # --- monetary fields: approximate equality ---
        for field in ("claim_amount", "amount_awarded"):
            if field in truth:
                if truth[field] is None:
                    assert result.get(field) is None, (
                        f"[{case_id}] {field}: expected None per truth_labels, "
                        f"got {result.get(field)!r}"
                    )
                else:
                    assert result.get(field) == pytest.approx(truth[field]), (
                        f"[{case_id}] {field}: recording produced {result.get(field)!r}, "
                        f"truth_label says {truth[field]!r}"
                    )

        # --- confidence bounds ---
        conf = result.get("confidence")
        assert conf is not None, f"[{case_id}] confidence field missing from parsed recording"
        if "confidence_min" in truth:
            assert conf >= truth["confidence_min"], (
                f"[{case_id}] confidence {conf:.2f} below truth_label minimum {truth['confidence_min']}"
            )
        if "confidence_max" in truth:
            assert conf <= truth["confidence_max"], (
                f"[{case_id}] confidence {conf:.2f} above truth_label maximum {truth['confidence_max']}"
            )

    @pytest.mark.parametrize("entry", _corpus_params(), ids=_corpus_ids())
    def test_confidence_threshold_status(self, entry, monkeypatch):
        """
        Entries flagged expect_low_confidence_status=True in truth_labels must
        parse to a confidence below CONFIDENCE_THRESHOLD (0.35); all others must
        be at or above it.  This catches regressions in the threshold boundary.
        """
        raw = _load_recording(entry["id"])

        def _mock_call_llm(system_prompt, user_prompt, **kwargs):
            return raw, 500, 120, "gemini:gemini-2.5-flash-lite", "gemini-2.5-flash-lite"

        monkeypatch.setattr(llm, "call_llm", _mock_call_llm)

        result = extract.extract_case(entry["judgment_text"])
        assert result is not None

        conf = result.get("confidence")
        expect_lc = entry["truth_labels"].get("expect_low_confidence_status", False)

        if expect_lc:
            assert conf < extract.CONFIDENCE_THRESHOLD, (
                f"[{entry['id']}] truth_labels flags low confidence "
                f"but recording produced conf={conf:.2f} ≥ {extract.CONFIDENCE_THRESHOLD}"
            )
        else:
            assert conf >= extract.CONFIDENCE_THRESHOLD, (
                f"[{entry['id']}] truth_labels expects high confidence "
                f"but recording produced conf={conf:.2f} < {extract.CONFIDENCE_THRESHOLD}"
            )

    # ------------------------------------------------------------------ #
    # Corpus structure meta-tests: catch corpus omissions early            #
    # ------------------------------------------------------------------ #

    def test_multilingual_entries_covered(self):
        """Corpus must include ≥2 non-English (multi-script) judgment entries."""
        non_english = [
            e for e in CORPUS
            if any(ord(c) > 127 for c in e["judgment_text"])
        ]
        assert len(non_english) >= 2, (
            f"Only {len(non_english)} non-English entries in corpus; need ≥2"
        )

    def test_all_outcome_directions_covered(self):
        """
        Corpus truth_labels must cover Allowed, Dismissed, Partially Allowed,
        Settled / Withdrawn, and Ex-parte — ensuring the pipeline is tested
        against all major outcome classes.
        """
        covered = {
            e["truth_labels"].get("outcome")
            for e in CORPUS
            if e["truth_labels"].get("outcome") is not None
        }
        required = {"Allowed", "Dismissed", "Partially Allowed", "Settled / Withdrawn", "Ex-parte"}
        missing = required - covered
        assert not missing, f"Corpus missing outcome coverage for: {missing}"

    def test_low_confidence_entry_present(self):
        """Corpus must include ≥1 entry with expect_low_confidence_status=True."""
        lc = [e for e in CORPUS if e["truth_labels"].get("expect_low_confidence_status")]
        assert lc, "Add at least one low-confidence corpus entry"

    def test_ev_entry_present(self):
        """Corpus must include ≥1 EV case (truth_labels is_ev=True)."""
        ev = [e for e in CORPUS if e["truth_labels"].get("is_ev") is True]
        assert ev, "Add at least one EV case to the corpus"


# ===========================================================================
# Live eval baseline tests
#
# eval_extract.py runs the refactored pipeline against REAL judgment texts
# fetched from the production database, using a live LLM call for each case.
# The results are saved to eval_results.json and committed as the post-refactor
# baseline.
#
# These tests load that baseline and assert quality thresholds so that a
# future change that degrades parse success or field agreement fails CI.
#
# To refresh the baseline (e.g. after a prompt or model change):
#     cd scraper && python3 eval_extract.py --n 10 --seed 42
# then review the output for regressions before committing eval_results.json.
# ===========================================================================

EVAL_RESULTS_PATH = os.path.join(SCRAPER_DIR, "eval_results.json")


def _load_eval_results() -> dict:
    """Load the committed eval baseline, skip if the file does not exist."""
    if not os.path.exists(EVAL_RESULTS_PATH):
        pytest.skip("eval_results.json not found — run eval_extract.py to generate it")
    with open(EVAL_RESULTS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class TestLiveEvalBaseline:
    """
    Quality-threshold tests against the eval_results.json baseline.

    These tests load results from an explicit live-LLM run against REAL DB cases
    (produced by eval_extract.py, committed, and human-reviewed).
    They catch regressions in parse success rate and field agreement that
    unit tests with mocked responses cannot detect.

    Thresholds:
      parse_rate                  ≥ 0.90   (90% of sampled cases parsed)
      avg_contested_agreement     ≥ 0.75   (75% agreement on non-null fields)
      confidence                  all in [0.0, 1.0]
      n_sampled                   ≥ 5

    Note: agreement is computed only over "contested" fields — those where at
    least one of prior/current is non-None.  Mutually-null fields are excluded
    to prevent inflating the metric with empty-slot matches.
    """

    # ------------------------------------------------------------------
    # Baseline file integrity
    # ------------------------------------------------------------------

    def test_baseline_file_exists(self):
        """eval_results.json must exist and be valid JSON."""
        assert os.path.exists(EVAL_RESULTS_PATH), (
            "eval_results.json is missing.\n"
            "Run:  cd scraper && python3 eval_extract.py --n 10 --seed 42"
        )
        data = _load_eval_results()
        assert isinstance(data, dict), "eval_results.json must be a JSON object"

    def test_baseline_has_required_keys(self):
        data = _load_eval_results()
        for key in ("n_sampled", "n_ok", "parse_rate", "cases"):
            assert key in data, f"eval_results.json missing key: {key!r}"

    def test_baseline_has_sufficient_sample(self):
        """Baseline must cover ≥5 real cases to be statistically meaningful."""
        data = _load_eval_results()
        assert data["n_sampled"] >= 5, (
            f"Baseline has only {data['n_sampled']} cases; regenerate with --n 10 or more"
        )

    # ------------------------------------------------------------------
    # Parse success rate
    # ------------------------------------------------------------------

    def test_parse_rate_above_threshold(self):
        """
        ≥90% of sampled real cases must parse to a valid dict.
        A lower rate indicates a regression in response parsing or LLM output
        format that would silently drop cases in production.
        """
        data = _load_eval_results()
        rate = data["parse_rate"]
        assert rate >= 0.90, (
            f"Parse rate {rate:.0%} is below the 90% threshold.\n"
            f"Baseline: {data['n_ok']}/{data['n_sampled']} cases parsed successfully.\n"
            "Check parse_response / validate_enums for regressions."
        )

    def test_no_llm_errors(self):
        """Zero LLM-level errors in the baseline — a non-zero count means the
        provider was misconfigured when the baseline was generated."""
        data = _load_eval_results()
        n_err = data.get("n_llm_error", 0)
        assert n_err == 0, (
            f"{n_err} LLM errors recorded in the baseline.\n"
            "Regenerate with a working LLM configuration."
        )

    # ------------------------------------------------------------------
    # Contested field agreement vs prior accepted extractions
    # ------------------------------------------------------------------

    def test_avg_contested_agreement_above_threshold(self):
        """
        Average agreement on *contested* fields (those where ≥1 side is non-None)
        must be ≥75%.  This detects prompt regressions and enum-set changes without
        being inflated by mutually-null field pairs.
        """
        data = _load_eval_results()
        avg = data.get("avg_contested_agreement")
        if avg is None:
            pytest.skip("No contested fields in this baseline sample — regenerate with richer cases")
        assert avg >= 0.75, (
            f"Avg contested agreement {avg:.0%} is below the 75% threshold.\n"
            f"Baseline: {data.get('n_contested_cases')} contested cases, avg {avg:.1%}.\n"
            "Review disagreements in eval_results.json."
        )

    def test_baseline_has_contested_cases(self):
        """At least half the sampled cases must have ≥1 contested field
        (i.e. the baseline isn't entirely null-only rows)."""
        data = _load_eval_results()
        n_contested = data.get("n_contested_cases", 0)
        n_ok = data["n_ok"]
        assert n_contested >= max(1, n_ok // 2), (
            f"Only {n_contested}/{n_ok} cases have contested fields — "
            "the baseline is dominated by null-only extractions and provides "
            "weak coverage.  Regenerate with a richer sample."
        )

    # ------------------------------------------------------------------
    # Per-case assertions
    # ------------------------------------------------------------------

    def test_all_cases_have_valid_confidence(self):
        """
        Every successfully-parsed case in the baseline must return a confidence
        in [0.0, 1.0].  Out-of-range values indicate a coercion regression in
        validate_enums or an unexpected model output format.
        """
        data = _load_eval_results()
        bad = []
        for case in data["cases"]:
            if case["status"] != "ok":
                continue
            conf = case.get("confidence")
            if conf is None or not (0.0 <= float(conf) <= 1.0):
                bad.append((case["case_number"], conf))
        assert not bad, (
            "Cases with invalid confidence values:\n"
            + "\n".join(f"  {cn}: {c!r}" for cn, c in bad)
        )

    def test_all_current_extractions_have_valid_enums(self):
        """
        The enum fields in every 'ok' case's current_extraction must be valid
        (i.e. in the allowed set or None).  An invalid enum in a live result
        means validate_enums failed to reject a bad value from the model.
        """
        data = _load_eval_results()
        allowed = {
            "issue_type":       extract.VALID_ISSUE_TYPES | {None},
            "sales_or_service": extract.VALID_SALES_OR_SERVICE | {None},
            "outcome":          extract.VALID_OUTCOME_VALUES | {None},
            "part_category":    extract.VALID_PART_CATEGORIES | {None},
        }
        bad = []
        for case in data["cases"]:
            if case["status"] != "ok":
                continue
            cur = case.get("current_extraction", {})
            for field, valid_set in allowed.items():
                val = cur.get(field)
                if val not in valid_set:
                    bad.append((case["case_number"], field, val))
        assert not bad, (
            "Invalid enum values in live extractions:\n"
            + "\n".join(f"  {cn} {f}={v!r}" for cn, f, v in bad)
        )


# ===========================================================================
# Live classification tests — calls the REAL, CURRENT LLM (no mock)
#
# These tests invoke llm.call_llm directly on corpus judgment texts and
# assert the classification fields match the human-authored truth_labels.
# They are skipped when no LLM provider is configured (CI without a key);
# when run with a key they validate that the CURRENT prompt + model still
# classifies correctly — catching prompt regressions that mocked tests miss.
#
# Run selectively:
#   pytest scraper/test_extract.py -k "LiveClassification" -v
# ===========================================================================

def _llm_configured() -> bool:
    """Return True when at least one LLM provider credential is present."""
    import os as _os
    return bool(
        _os.environ.get("GEMINI_API_KEY")
        or _os.environ.get("GEMINI_BASE_URL")
        or _os.environ.get("OPENAI_API_KEY")
        or _os.environ.get("OPENAI_BASE_URL")
    )


# Subset of corpus entries with fully-populated truth_labels suitable for
# live classification (exclude garbled/low-confidence entries where all labels
# are None — the LLM returning any answer would cause a false failure).
_LIVE_CORPUS = [
    e for e in CORPUS
    if not e["truth_labels"].get("expect_low_confidence_status")
    and e["truth_labels"].get("issue_type") is not None
    and e["truth_labels"].get("outcome") is not None
]


@pytest.mark.skipif(not _llm_configured(), reason="No LLM provider configured")
class TestLiveClassification:
    """
    Call the CURRENT prompt + model on corpus entries WITHOUT mocking call_llm.

    These tests will FAIL if:
    - The prompt (SYSTEM_INSTRUCTION) is changed in a way that misclassifies
      these well-understood cases.
    - The model is swapped for one that misunderstands the legal context.
    - The provider routing in llm.call_llm is broken.

    They are deliberately kept to a small subset (English cases only) to
    minimise cost and latency while still validating the end-to-end path.
    """

    @pytest.mark.parametrize(
        "entry",
        [e for e in _LIVE_CORPUS if not any(ord(c) > 127 for c in e["judgment_text"])],
        ids=[e["id"] for e in _LIVE_CORPUS if not any(ord(c) > 127 for c in e["judgment_text"])],
    )
    def test_live_classify_english(self, entry):
        """
        Call extract_case on an English corpus entry with the LIVE LLM.
        Assert issue_type and outcome match the human-authored truth_labels.
        """
        # No monkeypatch — real llm.call_llm is invoked
        result = extract.extract_case(entry["judgment_text"])
        assert result is not None, (
            f"[{entry['id']}] extract_case returned None — "
            "live LLM call failed or response was unparseable"
        )
        truth = entry["truth_labels"]
        case_id = entry["id"]

        # Assert the two most semantically meaningful fields
        assert result.get("issue_type") == truth["issue_type"], (
            f"[{case_id}] issue_type mismatch: "
            f"got {result.get('issue_type')!r}, expected {truth['issue_type']!r}\n"
            "This may indicate a prompt regression — review SYSTEM_INSTRUCTION."
        )
        assert result.get("outcome") == truth["outcome"], (
            f"[{case_id}] outcome mismatch: "
            f"got {result.get('outcome')!r}, expected {truth['outcome']!r}\n"
            "This may indicate a prompt regression — review SYSTEM_INSTRUCTION."
        )
        # Confidence must be in valid range
        conf = result.get("confidence")
        assert conf is not None and 0.0 <= float(conf) <= 1.0, (
            f"[{case_id}] invalid confidence: {conf!r}"
        )


# ===========================================================================
# Real-corpus live classification — PRIMARY regression gate
#
# These tests use REAL Indian consumer-court judgment texts fetched verbatim
# from the production database, with truth_labels independently authored by a
# human reading the text (NOT derived from any prior LLM extraction).
#
# Why this matters:
#   The synthetic corpus (judgment_corpus.py) uses crafted text whose
#   answer-bearing language closely mirrors the expected labels — any model
#   that can read English or Hindi can pass it.  The real corpus uses text
#   that the model sees for the first time (in the live run), with no hints
#   embedded by the test author.  A prompt or model regression that causes
#   misclassification on real text WILL fail these tests.
#
# Source traceability:
#   Each entry in REAL_CORPUS carries:
#     case_number  — the DB primary key used to re-fetch the text
#     text_sha256  — first 16 hex chars of sha256(judgment_text)
#   See scraper/fixtures/real_corpus.py for full labeling rationale.
#
# Run selectively:
#   pytest scraper/test_extract.py -k "RealCorpus" -v
# ===========================================================================

@pytest.mark.skipif(not _llm_configured(), reason="No LLM provider configured")
class TestRealCorpusLive:
    """
    Call the CURRENT prompt + model on REAL judgment texts from the DB.

    These are the tests that most closely simulate production use:
    - The texts are verbatim DB content, not authored for testability.
    - The truth_labels were set by a human reading the text, not by asking
      the LLM — so agreement is a genuine measure of prompt accuracy.
    - Multi-language entries (Hindi) exercise the same code path used in
      production multilingual batches.

    FAIL conditions that matter:
    - A prompt change in SYSTEM_INSTRUCTION that shifts how issue_type /
      outcome / sales_or_service are interpreted.
    - A model swap that performs significantly worse on Indian legal Hindi.
    - A parsing bug in parse_response or validate_enums.
    """

    @pytest.mark.parametrize(
        "entry",
        REAL_CORPUS,
        ids=[e["id"] for e in REAL_CORPUS],
    )
    def test_real_corpus_live(self, entry):
        """
        Call extract_case on a real DB judgment text with the LIVE LLM.
        Assert all truth-labeled fields match independently-authored labels.
        """
        # No monkeypatch — real llm.call_llm is invoked
        result = extract.extract_case(entry["judgment_text"])
        assert result is not None, (
            f"[{entry['id']} / {entry['case_number']}] "
            "extract_case returned None — LLM call failed or response was unparseable."
        )
        truth = entry["truth_labels"]
        case_id = entry["id"]
        case_num = entry["case_number"]
        prefix = f"[{case_id} / {case_num}]"

        for field, expected in truth.items():
            got = result.get(field)
            assert got == expected, (
                f"{prefix} {field} mismatch:\n"
                f"  got:      {got!r}\n"
                f"  expected: {expected!r}\n"
                "Truth label was independently authored from reading the real judgment text.\n"
                "A mismatch indicates a prompt or model regression — review SYSTEM_INSTRUCTION."
            )

        # Confidence sanity check regardless of truth_labels
        conf = result.get("confidence")
        assert conf is not None and 0.0 <= float(conf) <= 1.0, (
            f"{prefix} invalid confidence: {conf!r}"
        )

    def test_real_corpus_sha256_matches(self):
        """
        Verify the text stored in REAL_CORPUS matches its recorded sha256 prefix.
        This ensures the corpus was not accidentally edited after labeling.
        """
        import hashlib
        for entry in REAL_CORPUS:
            text = entry["judgment_text"]
            actual_sha = hashlib.sha256(text.encode()).hexdigest()[:16]
            stored_sha = entry.get("text_sha256", "")
            assert actual_sha == stored_sha, (
                f"[{entry['id']}] SHA-256 mismatch — judgment_text was edited "
                f"after truth_labels were authored.\n"
                f"  stored:   {stored_sha!r}\n"
                f"  computed: {actual_sha!r}\n"
                "If the text was intentionally changed, re-label truth_labels "
                "and update text_sha256."
            )
