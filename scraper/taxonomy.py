"""
taxonomy.py — classification taxonomy for the LLM extraction pipeline.

To target a different industry, duplicate this file (e.g. taxonomy_banking.py),
edit the constants below, then either:
  - replace this file, or
  - set the TAXONOMY_MODULE env var to your new module name (without .py).

This is the industry-equivalent of company.py: company.py controls WHICH
company's cases get scraped, this file controls WHAT the LLM is allowed to
extract about them. Everything in extract.py is generic; only the constants
below change between industries.

Rather than hand-authoring a new taxonomy from scratch, run
`python3 generate_taxonomy.py` — it samples already-harvested judgment text
(or falls back to just COMPANY_NAME) and asks the already-configured LLM to
draft a taxonomy_generated.py in this same shape, for human review before
activating it via TAXONOMY_MODULE=taxonomy_generated.
"""

# ---------------------------------------------------------------------------
# Allowed enum values — validate_enums() in extract.py nulls out anything
# the LLM returns that isn't in these sets.
# ---------------------------------------------------------------------------

VALID_ISSUE_TYPES = {
    "Vehicle Defect", "Service Deficiency", "Misleading Advertisement",
    "Unfair Trade Practice", "Extended Warranty / AMC",
    "Finance / Insurance", "Delivery / Documentation", "Other",
}

VALID_OUTCOME_VALUES = {
    "Allowed", "Dismissed", "Partially Allowed", "Remanded",
    "Settled / Withdrawn", "Ex-parte", "Other",
}

VALID_SALES_OR_SERVICE = {"Sales", "Service"}

VALID_PART_CATEGORIES = {
    "Engine / Transmission", "Electrical / AC", "Body / Paint",
    "Infotainment", "Suspension / Brakes", "Fuel System", "Other",
}

# ---------------------------------------------------------------------------
# Field descriptions — the industry-specific half of the extraction prompt.
# Keys must match the field names extract.py's SYSTEM_INSTRUCTION lists.
# ---------------------------------------------------------------------------

FIELD_DESCRIPTIONS = {
    "product_model": 'specific vehicle model (e.g. "ExampleCo Electra EV", "ExampleCo Compact"); null if not mentioned',
    "is_ev": "true if vehicle is electric; null if not mentioned",
    "part_involved": 'specific part that failed (e.g. "Air Conditioner", "Engine", "Battery"); null if not mentioned',
    "dealership": "dealer/service-centre name, normalised without legal suffixes; null if not identifiable",
}

# ---------------------------------------------------------------------------
# Few-shot examples appended to the prompt, verbatim. Keep 2-3 examples
# spanning at least one non-English language so multilingual extraction
# quality doesn't regress.
# ---------------------------------------------------------------------------

FEW_SHOT_EXAMPLES = """EXAMPLE 1 — English:
Input: "The complainant purchased an ExampleCo Electra EV from XYZ Motors for Rs.15,00,000. Battery failed within 3 months. Commission allowed the complaint and directed OP to refund Rs.8,50,000 with interest."
Output: {"issue_type":"Vehicle Defect","sales_or_service":"Sales","warranty_related":true,"product_model":"ExampleCo Electra EV","is_ev":true,"part_involved":"Battery","part_category":"Electrical / AC","dealership":"XYZ Motors","outcome":"Partially Allowed","claim_amount":1500000,"amount_awarded":850000,"grounds_taken":["Defective battery within warranty","Failure to repair"],"confidence":0.92,"source_snippet":"directed OP to refund Rs.8,50,000 with interest"}

EXAMPLE 2 — Hindi:
Input: "परिवादी ने एक्मे कॉम्पैक्ट कार खरीदी जिसमें इंजन में दोष था। राम मोटर्स ने मरम्मत से इनकार किया। जिला आयोग ने परिवाद स्वीकार करते हुए विरोधी पक्ष को रु. 45,000/- क्षतिपूर्ति एवं रु. 5,000/- वाद व्यय अदा करने का आदेश दिया।"
Output: {"issue_type":"Vehicle Defect","sales_or_service":"Sales","warranty_related":false,"product_model":"ExampleCo Compact","is_ev":false,"part_involved":"Engine","part_category":"Engine / Transmission","dealership":"Ram Motors","outcome":"Allowed","claim_amount":null,"amount_awarded":50000,"grounds_taken":["Engine defect","Refusal to repair"],"confidence":0.88,"source_snippet":"विरोधी पक्ष को रु. 45,000/- क्षतिपूर्ति एवं रु. 5,000/- वाद व्यय"}

EXAMPLE 3 — Marathi:
Input: "तक्रारदाराने एक्मे मोटर्सची सेडान कार खरेदी केली. वाहनाच्या ए.सी. मध्ये सातत्याने बिघाड येत होता. अधिकृत सेवा केंद्राने दुरुस्ती केली नाही. मंचाने तक्रार अंशतः मान्य करून विरुद्ध पक्षाला रु.30,000/- देण्याचा आदेश केला."
Output: {"issue_type":"Service Deficiency","sales_or_service":"Service","warranty_related":true,"product_model":"ExampleCo Sedan","is_ev":false,"part_involved":"Air Conditioner","part_category":"Electrical / AC","dealership":null,"outcome":"Partially Allowed","claim_amount":null,"amount_awarded":30000,"grounds_taken":["Recurring AC defect","Failure of authorized service centre to repair"],"confidence":0.85,"source_snippet":"रु.30,000/- देण्याचा आदेश केला"}"""
