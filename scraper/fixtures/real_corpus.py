"""
Real judgment texts fetched directly from the production database.

Each entry records:
  case_number   — reproducible primary key; re-fetch with:
                  SELECT text_plain FROM proceedings
                  WHERE case_number = '<case_number>'
                  ORDER BY length(text_plain) DESC LIMIT 1;
  text_sha256   — SHA-256 hex digest of the judgment_text string as-stored here,
                  for provenance and drift detection.
  judgment_text — verbatim text from proceedings.text_plain at fetch time.
  truth_labels  — independently human-authored classification of the text
                  (NOT derived from any prior LLM extraction); authored by
                  reading the judgment text and applying the same enum
                  vocabulary as SYSTEM_INSTRUCTION in extract.py.

These entries are the PRIMARY regression gate: a test that calls the live LLM
on real Indian consumer-court judgments and compares to independently reviewed
labels will catch prompt or model regressions that synthetic-corpus tests miss.

To add a new entry:
  1. Fetch the text from the DB.
  2. Read it yourself and fill truth_labels independently.
  3. Run the LLM once to confirm it agrees; record any acceptable alternates.
  4. Append the entry below with a clear labeling rationale comment.
"""

REAL_CORPUS = [
    # -------------------------------------------------------------------------
    # Source: DC/110/CC/33/2015
    # Language: Hindi
    # Text length: 913 chars
    # SHA-256 prefix (first 16 hex chars): ef5ed0ad33affd13
    #
    # Human labeling rationale (read verbatim before setting these fields):
    #   "परिवाद विपक्षी संख्या 01 व 02 के विरूद्ध स्वीकार किया जाकर"
    #     → complaint accepted against OP 1 & 2 → outcome = Allowed
    #   "खरीदसुद्दा वाहन ट्रक के इंजन की खराबी"
    #     → engine defect in a purchased truck → issue_type = Vehicle Defect
    #     → sales_or_service = Sales (purchase context)
    #     → part_category = Engine / Transmission
    #   "93,491 रूपये … 25,000 रूपये … 5,000 रूपये"
    #     → total monetary award = 1,23,491
    #   "विपक्षी संख्या 03, 04 व 05 के विरूद्ध परिवाद खारिज"
    #     → OP 3-5 dismissed; primary complaint against OP 1&2 → Allowed
    # -------------------------------------------------------------------------
    {
        "id":           "real-hi-vehicle-defect-allowed",
        "case_number":  "DC/110/CC/33/2015",
        "text_sha256":  "ef5ed0ad33affd13",   # first 16 hex chars of sha256
        "judgment_text": (
            "अतः परिवादी रामरतन चैधरी द्वारा उपभोक्ता संरक्षण अधिनियम, 1986 की धारा 12 "
            "के अन्तर्गत प्रस्तुत परिवाद विपक्षी संख्या 01 व 02 के विरूद्ध स्वीकार किया "
            "जाकर उक्त विपक्षीगण को आदेशित किया जाता है कि वे परिवादी द्वारा खरीदसुद्दा "
            "वाहन ट्रक के इंजन की खराबी को दुरूस्त करवाने की राशि 93,491/- रूपये (तेरानवे "
            "हजार चार सौ इकरानवे रूपये) का परिवादी को भुगतान दो माह की अवधि के अंदर करें। "
            "परिवादी उक्त राशि पर परिवाद प्रस्तुत किये जाने की तिथि से वास्तविक वसूली की "
            "तिथि तक नौ प्रतिशत वार्षिक दर से ब्याज भी प्राप्त करने का अधिकारी है। इसके "
            "अतिरिक्त उक्त विपक्षीगण द्वारा परिवादी को शारीरिक व मानसिक वेदना की क्षतिपूर्ति "
            "के रूप में 25,000/- रूपये (पच्चीस हजार रूपये) तथा परिवाद व्यय के रूप में 5,000/- "
            "रूपये (पांच हजार रूपये) की राशि भी अदा की जावे। दो माह की अवधि के पश्चात् उक्त "
            "राशि पर भी परिवादी नौ प्रतिशत वार्षिक दर से ब्याज प्राप्त करने का अधिकारी होगा। "
            "विपक्षी संख्या 03, 04 व 05 के विरूद्ध परिवाद खारिज किया जाता है।"
        ),
        "truth_labels": {
            "issue_type":       "Vehicle Defect",
            "sales_or_service": "Sales",
            "outcome":          "Allowed",
            "part_category":    "Engine / Transmission",
            "is_ev":            False,
            # product_model omitted — text does not name a vehicle model (ट्रक = truck)
        },
    },

    # -------------------------------------------------------------------------
    # Source: DC/574/CC/305/2025
    # Language: English
    # Text length: 1186 chars (order-portion of judgment)
    # SHA-256 prefix (first 16 hex chars): c610af42061cbe60
    #
    # Human labeling rationale (read verbatim before setting these fields):
    #   "this complaint is partly allowed"
    #     → outcome = Partially Allowed
    #   "replace the defective vehicle, Acme Curvv DCA 1.2 Petrol Automatic"
    #     → issue_type = Vehicle Defect
    #     → product_model = Acme Curvv (DCA 1.2 Petrol Automatic = variant, not model name)
    #     → is_ev = False (Petrol)
    #   "purchase amount of Rs.19,50,000 … accessories and warranty costs"
    #     → sales_or_service = Sales (purchase context)
    #     → warranty_related = True (warranty costs mentioned, replace/refund directed)
    # -------------------------------------------------------------------------
    {
        "id":           "real-en-vehicle-defect-partial",
        "case_number":  "DC/574/CC/305/2025",
        "text_sha256":  "c610af42061cbe60",
        "judgment_text": (
            "In the result, this complaint is partly allowed. The opposite parties 1 & 2 "
            "are jointly and severally directed to replace the defective vehicle, Acme Curvv "
            "DCA 1.2 Petrol Automatic, Reg. No.TN-19-BC-7265, with a brand-new, defect-free "
            "vehicle of the same model and variant; or, in the alternative, to refund the "
            "entire purchase amount of Rs.19,50,000/- (Rupees Nineteen Lakh Fifty Thousand "
            "only) including all payments, accessories and warranty costs, together with "
            "interest @ 12% p.a. from date of payment till realization; or to pay a sum of "
            "Rs.1,00,000/- (Rupees One Lakh only) towards compensation for mental agony, "
            "harassment, inconvenience, negligence and deficiency in service to the "
            "complainant; and to pay a sum of Rs.10,000/- (Rupees Ten Thousand only) towards "
            "cost of the proceedings to the complainant within two months from the date of "
            "receipt of copy of this order. Failing which, the above said amounts "
            "(Rs.1,00,000/- + 10,000/- = 1,10,000) shall carry interest @ 9% p.a. from the "
            "date of order till the date of realization."
        ),
        "truth_labels": {
            "issue_type":       "Vehicle Defect",
            "sales_or_service": "Sales",
            "outcome":          "Partially Allowed",
            "product_model":    "Acme Curvv",
            "is_ev":            False,
            "warranty_related": True,
        },
    },
]
