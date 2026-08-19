import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BookOpen } from 'lucide-react';

interface DocsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocsModal({ open, onOpenChange }: DocsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <BookOpen className="w-5 h-5" />
            <DialogTitle>Dashboard Documentation</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-6 text-sm">
          {/* Purpose */}
          <section>
            <h3 className="font-semibold text-foreground mb-2">Purpose</h3>
            <p className="text-muted-foreground leading-relaxed">
              This dashboard monitors consumer dispute cases filed at the National Consumer Disputes
              Redressal Commission (NCDRC) and state forums for a configured respondent company. It is
              intended for internal legal and strategy teams tracking litigation exposure, win/loss
              patterns, and counsel performance across Indian consumer courts.
            </p>
          </section>

          {/* Data Coverage */}
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Data Coverage</h3>
            <p className="text-blue-800 leading-relaxed text-sm">
              The dataset covers cases filed from <strong>2015 to present</strong>, sourced from the NCDRC
              public registry. Extraction is ongoing — the corpus is updated periodically as new cases are
              filed and existing cases receive hearing updates or disposals.
            </p>
          </section>

          {/* Data Extraction */}
          <section>
            <h3 className="font-semibold text-foreground mb-2">Data Extraction</h3>
            <p className="text-muted-foreground leading-relaxed">
              Case data is sourced from the NCDRC public registry. The extraction pipeline fetches case
              listings and, where available, full judgment text. Extraction runs periodically — open cases
              are re-checked to capture newly posted hearing updates and disposals, and newly disposed cases
              are processed to extract structured verdict details.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-2">
              Only information published in the public registry is used. No internal company documents
              or communications are accessed at this stage.
            </p>
          </section>

          {/* Language Models */}
          <section>
            <h3 className="font-semibold text-foreground mb-2">Language Models</h3>
            <p className="text-muted-foreground leading-relaxed">
              Structured fields — including issue type, verdict, involved parties, forum name, compensation
              amounts, and grounds of complaint — are extracted from raw case text using{' '}
              <span className="font-medium text-foreground">Gemini 2.5 Flash</span>. Each extraction
              produces a confidence score. Extractions with a confidence below{' '}
              <span className="font-medium text-foreground">0.35</span> are flagged as low-confidence and
              excluded from charts and aggregations to avoid polluting the statistics with uncertain data.
            </p>
          </section>

          {/* Panel Guide */}
          <section>
            <h3 className="font-semibold text-foreground mb-2">Panel-by-Panel Guide</h3>
            <div className="flex flex-col gap-3 text-muted-foreground leading-relaxed">
              <div>
                <span className="font-medium text-foreground">KPI Strip</span> — headline counts (total
                cases, pending hearings, disposed cases) drawn directly from registry listings.
              </div>
              <div>
                <span className="font-medium text-foreground">State Heatboard</span> — geographic
                distribution of cases by the forum's state. Populated from registry metadata, so coverage
                is near-complete.
              </div>
              <div>
                <span className="font-medium text-foreground">Hearing Radar</span> — upcoming hearing
                dates and hearing-stage distribution. Sourced from case listing data.
              </div>
              <div>
                <span className="font-medium text-foreground">Escalation Ladder &amp; Stage Distribution</span>{' '}
                — tracks which procedural stage each case is in (admission, notice, arguments, reserved,
                etc.). Based on status text from the registry.
              </div>
              <div>
                <span className="font-medium text-foreground">Forum Scorecard</span> — win/loss rates
                broken down by forum. Requires AI extraction to determine verdict; only cases with
                successful extraction contribute.
              </div>
              <div>
                <span className="font-medium text-foreground">Issue Mix</span> — breakdown of complaint
                categories (defect, deficiency, unfair trade practice, etc.) extracted by the AI from
                judgment text.
              </div>
              <div>
                <span className="font-medium text-foreground">Grounds Analysis</span> — specific legal
                grounds cited in judgments, extracted by the AI.
              </div>
              <div>
                <span className="font-medium text-foreground">Verdict Breakdown &amp; Outcome Funnel</span>{' '}
                — disposition outcomes (allowed, dismissed, settled, ex-parte, etc.) extracted by the AI.
              </div>
              <div>
                <span className="font-medium text-foreground">Claimed vs. Awarded</span> — monetary
                compensation amounts as claimed by the complainant versus as awarded by the forum, extracted
                from judgment text.
              </div>
              <div>
                <span className="font-medium text-foreground">Counsel Watchlist</span> — opposing counsel
                appearing most frequently, extracted from party and representation fields.
              </div>
              <div>
                <span className="font-medium text-foreground">Dealership Watchlist</span> — dealerships
                named most often in complaints, extracted from party names.
              </div>
              <div>
                <span className="font-medium text-foreground">Precedent Recall</span> — notable judgments
                surfaced for strategic reference.
              </div>
            </div>
          </section>

          {/* Coverage Caveat */}
          <section className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="font-semibold text-amber-900 mb-2">Coverage Caveat</h3>
            <p className="text-amber-800 leading-relaxed text-sm">
              A significant share of cases in the public registry do not contain sufficient text — full
              judgment documents, detailed orders, or party information — to extract structured details. All
              charts and statistics on this dashboard are based <em>solely</em> on cases where AI extraction
              succeeded and met the confidence threshold. They should be read as <strong>indicative</strong>{' '}
              of trends, not as exhaustive counts. The raw case totals shown in the KPI strip represent the
              full registry population; extracted-field panels reflect only the subset with usable data.
            </p>
          </section>

          {/* Future / Internal Records */}
          <section>
            <h3 className="font-semibold text-foreground mb-2">Future Roadmap — Internal Records</h3>
            <p className="text-muted-foreground leading-relaxed">
              When the company integrates its internal data — complaint intake records, company responses,
              legal correspondence, and internal case notes — the dashboard can be expanded to draw on those
              documents alongside the public registry data. This will unlock the{' '}
              <span className="font-medium text-foreground">Internal Records</span> lens, enabling richer
              analysis: cross-referencing public outcomes with internal escalation patterns, tracking
              response timelines, and identifying systemic product or service issues that appear across
              multiple complaints before they reach the forum stage.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
