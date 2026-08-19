import { Case } from '@workspace/api-client-react';
import { DisposedKpiStrip } from '@/components/panels/disposed-kpi-strip';
import { VerdictScorecard } from '@/components/panels/verdict-scorecard';
import { StateHeatboard } from '@/components/panels/state-heatboard';
import { ForumScorecard } from '@/components/panels/forum-scorecard';
import { GroundsAnalysis } from '@/components/panels/grounds-analysis';
import { ClaimedAwarded } from '@/components/panels/claimed-awarded';
import { WarrantyImpact } from '@/components/panels/warranty-impact';
import { FilingYearDistribution } from '@/components/panels/filing-year-distribution';
import { ProductOutcomes } from '@/components/panels/product-outcomes';
import { CounselPerformance } from '@/components/panels/counsel-performance';
import { JudgmentBrowser } from '@/components/panels/judgment-browser';

interface Props { cases: Case[] }

export function DisposedDashboard({ cases }: Props) {
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {/* KPI Strip */}
      <DisposedKpiStrip cases={cases} />

      {/* Row 1: Verdict Scorecard + State Heatboard (win-rate) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 md:min-h-[320px]">
        <VerdictScorecard cases={cases} />
        <StateHeatboard cases={cases} colorBy="winRate" />
      </div>

      {/* Row 2: Forum Scorecard + Grounds Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 md:min-h-[380px]">
        <ForumScorecard cases={cases} />
        <GroundsAnalysis cases={cases} />
      </div>

      {/* Row 3: Claimed vs Awarded (with recovery trend) + Warranty Impact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 md:min-h-[340px]">
        <ClaimedAwarded cases={cases} />
        <WarrantyImpact cases={cases} />
      </div>

      {/* Row 4: Filing Year Distribution + Product Outcomes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 md:min-h-[280px]">
        <FilingYearDistribution cases={cases} />
        <ProductOutcomes cases={cases} />
      </div>

      {/* Row 5: Counsel Performance (full width, tabbed) */}
      <CounselPerformance cases={cases} />

      {/* Row 6: Judgment Browser (full width) */}
      <JudgmentBrowser cases={cases} />
    </div>
  );
}
