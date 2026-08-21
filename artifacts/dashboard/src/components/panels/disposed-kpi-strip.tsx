import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Case } from '@workspace/api-client-react';
import { differenceInDays, startOfDay } from 'date-fns';

const FAVOURABLE_OUTCOMES = new Set(['Allowed', 'Partially Allowed']);
const DISMISSED_OUTCOMES  = new Set(['Dismissed', 'Ex-parte']);
const KNOWN_OUTCOMES = new Set(['Allowed', 'Dismissed', 'Partially Allowed', 'Remanded', 'Settled / Withdrawn', 'Ex-parte', 'Other']);

function formatCurrency(amount: number): string {
  if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(1)} Cr`;
  if (amount >= 1_00_000)    return `₹${(amount / 1_00_000).toFixed(1)} L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface Props { cases: Case[] }

export function DisposedKpiStrip({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const metrics = useMemo(() => {
    const today = startOfDay(new Date());
    const withKnown = cases.filter(c => c.outcome && KNOWN_OUTCOMES.has(c.outcome));
    const withFav   = withKnown.filter(c => c.outcome && FAVOURABLE_OUTCOMES.has(c.outcome));
    const withDis   = withKnown.filter(c => c.outcome && DISMISSED_OUTCOMES.has(c.outcome));

    const allowedPct   = withKnown.length > 0 ? Math.round((withFav.length  / withKnown.length) * 100) : null;
    const dismissedPct = withKnown.length > 0 ? Math.round((withDis.length  / withKnown.length) * 100) : null;

    let totalClaimed = 0, totalAwarded = 0, recoveryCount = 0;
    for (const c of cases) {
      if (c.claim_amount != null && c.amount_awarded != null && c.claim_amount > 0) {
        totalClaimed += c.claim_amount;
        totalAwarded += c.amount_awarded;
        recoveryCount++;
      }
    }
    const avgRecovery = totalClaimed > 0 ? Math.round((totalAwarded / totalClaimed) * 100) : null;

    const durations: number[] = [];
    for (const c of cases) {
      if (c.filing_date) {
        const d = differenceInDays(today, new Date(c.filing_date));
        if (d > 0) durations.push(d);
      }
    }
    const medianDays = durations.length > 0 ? Math.round(median(durations)) : null;
    const medianYrs  = medianDays != null ? (medianDays / 365).toFixed(1) : null;

    const withJudgment = cases.filter(c => c.has_judgment);

    return {
      total: cases.length,
      withKnown: withKnown.length,
      withFav,
      withDis,
      allowedPct,
      dismissedPct,
      avgRecovery,
      totalAwarded,
      recoveryCount,
      medianYrs,
      withJudgmentCount: withJudgment.length,
    };
  }, [cases]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border/50 border border-border/50 rounded-xl overflow-hidden shadow-sm">
      {/* Total */}
      <Cell
        label="Total Disposed"
        accent="border-chart-5"
        onClick={() => openDrawer('All Disposed Cases', cases)}
      >
        <span className="text-2xl sm:text-3xl font-bold font-sans text-foreground leading-none">{metrics.total.toLocaleString()}</span>
      </Cell>

      {/* Dismissed % — OEM won */}
      <Cell
        label="Dismissed %"
        accent="border-chart-1"
        onClick={() => openDrawer('Dismissed — OEM Won', metrics.withDis)}
      >
        {metrics.dismissedPct != null ? (
          <>
            <span className="text-2xl sm:text-3xl font-bold font-sans text-chart-1 leading-none">{metrics.dismissedPct}%</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">{metrics.withDis.length} dismissed / ex-parte</span>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground/60">Extraction pending</span>
        )}
      </Cell>

      {/* Allowed % — OEM lost */}
      <Cell
        label="Allowed %"
        accent="border-chart-4"
        onClick={() => openDrawer('Complaint Allowed — OEM Lost', metrics.withFav)}
      >
        {metrics.allowedPct != null ? (
          <>
            <span className="text-2xl sm:text-3xl font-bold font-sans text-chart-4 leading-none">{metrics.allowedPct}%</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">{metrics.withFav.length} of {metrics.withKnown} decided</span>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground/60">Extraction pending</span>
        )}
      </Cell>

      {/* Total Awarded */}
      <Cell label="Total Awarded" accent="border-chart-3">
        {metrics.recoveryCount > 0 ? (
          <>
            <span className="text-2xl sm:text-3xl font-bold font-sans text-chart-3 leading-none">{formatCurrency(metrics.totalAwarded)}</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">{metrics.recoveryCount} cases</span>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground/60">Extraction pending</span>
        )}
      </Cell>

      {/* Median Duration */}
      <Cell label="Median Duration" accent="border-chart-5">
        {metrics.medianYrs != null ? (
          <>
            <span className="text-2xl sm:text-3xl font-bold font-sans text-foreground leading-none">{metrics.medianYrs} yr</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">filing → present</span>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground/60">No filing dates</span>
        )}
      </Cell>

      {/* With Judgment */}
      <Cell label="With Judgment" accent="border-chart-2">
        {metrics.withJudgmentCount > 0 ? (
          <>
            <span className="text-2xl sm:text-3xl font-bold font-sans text-chart-2 leading-none">{metrics.withJudgmentCount.toLocaleString()}</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">full text harvested</span>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground/60">None harvested yet</span>
        )}
      </Cell>
    </div>
  );
}

function Cell({ label, accent, onClick, children }: {
  label: string;
  accent: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-card p-4 sm:p-5 flex flex-col gap-1.5 border-l-2 min-h-[88px] ${accent} ${onClick ? 'cursor-pointer hover:bg-muted/20 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-none">{label}</div>
      {children}
    </div>
  );
}
