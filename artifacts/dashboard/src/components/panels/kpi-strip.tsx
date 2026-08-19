import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Case } from '@workspace/api-client-react';
import { differenceInDays, startOfDay } from 'date-fns';

// Accent colours per metric (left-border accent)
const ACCENT = {
  total:       'border-chart-5',   // slate
  hearings:    'border-chart-1',   // teal
  executions:  'border-chart-4',   // coral
  pre2021:     'border-chart-2',   // indigo
};

export function KpiStrip({ cases }: { cases: Case[] }) {
  const { openDrawer } = useDashboard();

  const metrics = useMemo(() => {
    const today = startOfDay(new Date());

    const hearings30d = cases.filter(c => {
      if (!c.next_hearing) return false;
      const days = differenceInDays(new Date(c.next_hearing), today);
      return days >= 0 && days <= 30;
    });

    const liveExecutions = cases.filter(c =>
      c.canonical_stage !== 'Disposed' && c.case_type.includes('Execution')
    );

    const pre2021Live = cases.filter(c => {
      if (c.canonical_stage === 'Disposed') return false;
      if (!c.filing_date) return false;
      return parseInt(c.filing_date.substring(0, 4)) < 2021;
    });

    return { total: cases, hearings30d, liveExecutions, pre2021Live };
  }, [cases]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50 border border-border/50 rounded-xl overflow-hidden shadow-sm">
      <KpiCell
        label="Total Matters"
        value={metrics.total.length.toLocaleString()}
        accent={ACCENT.total}
        valueClass="text-foreground"
        onClick={() => openDrawer('Total Matters', metrics.total)}
      />
      <KpiCell
        label="Hearings Next 30 Days"
        value={metrics.hearings30d.length.toLocaleString()}
        accent={ACCENT.hearings}
        valueClass="text-chart-1"
        onClick={() => openDrawer('Hearings Next 30 Days', metrics.hearings30d)}
      />
      <KpiCell
        label="Live Executions"
        value={metrics.liveExecutions.length.toLocaleString()}
        accent={ACCENT.executions}
        valueClass="text-chart-4"
        onClick={() => openDrawer('Live Executions', metrics.liveExecutions)}
      />
      <KpiCell
        label="Pre-2021 Live"
        value={metrics.pre2021Live.length.toLocaleString()}
        accent={ACCENT.pre2021}
        valueClass="text-chart-2"
        onClick={() => openDrawer('Pre-2021 Still Live', metrics.pre2021Live)}
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  accent,
  valueClass,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  accent: string;
  valueClass: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-card p-4 sm:p-5 flex flex-col gap-1.5 cursor-pointer hover:bg-muted/20 transition-colors border-l-2 min-h-[88px] ${accent}`}
      onClick={onClick}
    >
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-none">
        {label}
      </div>
      <div className={`text-2xl sm:text-3xl font-bold font-sans leading-none ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground/60">{sub}</div>}
    </div>
  );
}
