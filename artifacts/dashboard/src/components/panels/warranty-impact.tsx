import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

// OEM's perspective: Dismissed/Ex-parte first (good); Allowed last (bad)
const OUTCOME_ORDER = [
  'Dismissed', 'Ex-parte', 'Settled / Withdrawn',
  'Remanded', 'Allowed', 'Partially Allowed', 'Other',
];
const OUTCOME_COLORS: Record<string, string> = {
  'Dismissed':           'hsl(174 62% 38%)',   // teal — OEM won
  'Ex-parte':            'hsl(174 62% 55%)',   // lighter teal — OEM won
  'Allowed':             'hsl(9 78% 58%)',     // coral — OEM lost
  'Partially Allowed':   'hsl(9 78% 72%)',     // lighter coral — OEM lost partially
  'Settled / Withdrawn': 'hsl(245 58% 51%)',  // indigo
  'Remanded':            'hsl(38 95% 49%)',    // amber
  'Other':               'hsl(var(--muted-foreground))',
};

function outcomeLabel(o: string) {
  return o === 'Settled / Withdrawn' ? 'Settled' : o;
}

function buildCounts(group: Case[]) {
  const map: Record<string, Case[]> = {};
  for (const c of group) {
    const o = c.outcome ?? 'Other';
    if (!map[o]) map[o] = [];
    map[o].push(c);
  }
  return map;
}

export function WarrantyImpact({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { warranty, nonWarranty, warrantyPct, total, outcomes, maxCount, isSample } = useMemo(() => {
    const good = cases.filter(
      (c) => c.extraction_status === 'full' && c.warranty_related != null,
    );
    const warranty: Case[] = [];
    const nonWarranty: Case[] = [];
    for (const c of good) {
      (c.warranty_related ? warranty : nonWarranty).push(c);
    }
    const total = warranty.length + nonWarranty.length;
    const warrantyPct = total > 0 ? Math.round((warranty.length / total) * 100) : 0;

    const wc = buildCounts(warranty);
    const nwc = buildCounts(nonWarranty);
    const allOutcomes = [...new Set([...Object.keys(wc), ...Object.keys(nwc)])];
    const outcomes = OUTCOME_ORDER.filter((o) => allOutcomes.includes(o)).concat(
      allOutcomes.filter((o) => !OUTCOME_ORDER.includes(o)),
    );
    const maxCount = Math.max(
      ...outcomes.map((o) => Math.max(wc[o]?.length ?? 0, nwc[o]?.length ?? 0)),
      1,
    );
    const isSample =
      cases.some((c) => c.extraction_status === 'sample') &&
      !cases.some((c) => c.extraction_status === 'full');

    return { warranty, nonWarranty, warrantyPct, total, outcomes, maxCount, wc, nwc, isSample };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases]);

  // Re-derive wc/nwc inside render so openDrawer closures are stable
  const wc = buildCounts(warranty);
  const nwc = buildCounts(nonWarranty);

  if (total === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">
            Warranty Impact
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-xs text-muted-foreground/50 font-mono">
          Extraction pending
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">
          Warranty Impact
        </CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Headline */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold text-foreground">{warrantyPct}%</span>
          <span className="font-mono text-xs text-muted-foreground">
            warranty-related&ensp;·&ensp;{warranty.length} of {total} cases
          </span>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_6rem_1fr] gap-x-2 mb-0.5">
          <div className="font-mono text-[10px] text-muted-foreground text-center uppercase tracking-wide">
            Warranty
          </div>
          <div />
          <div className="font-mono text-[10px] text-muted-foreground text-center uppercase tracking-wide">
            No warranty
          </div>
        </div>

        {/* Outcome rows — butterfly layout */}
        <div className="flex flex-col gap-1.5">
          {outcomes.map((outcome) => {
            const w = wc[outcome] ?? [];
            const nw = nwc[outcome] ?? [];
            const color = OUTCOME_COLORS[outcome] ?? 'hsl(var(--muted-foreground))';
            const wPct = (w.length / maxCount) * 100;
            const nwPct = (nw.length / maxCount) * 100;
            return (
              <div key={outcome} className="grid grid-cols-[1fr_6rem_1fr] items-center gap-x-2">
                {/* Warranty bar — grows left-to-right from centre outward (reversed) */}
                <button
                  onClick={() => w.length && openDrawer(`Warranty · ${outcome}`, w)}
                  disabled={!w.length}
                  className="flex items-center justify-end gap-1.5 group hover:opacity-80 transition-opacity disabled:cursor-default"
                >
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums w-4 text-right">
                    {w.length || ''}
                  </span>
                  <div className="h-1.5 w-16 bg-muted/30 rounded-full overflow-hidden flex justify-end">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${wPct}%`, background: color }}
                    />
                  </div>
                </button>

                {/* Label */}
                <span className="font-mono text-[10px] text-muted-foreground text-center whitespace-nowrap">
                  {outcomeLabel(outcome)}
                </span>

                {/* Non-warranty bar — grows left-to-right */}
                <button
                  onClick={() => nw.length && openDrawer(`No warranty · ${outcome}`, nw)}
                  disabled={!nw.length}
                  className="flex items-center gap-1.5 group hover:opacity-80 transition-opacity disabled:cursor-default"
                >
                  <div className="h-1.5 w-16 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${nwPct}%`, background: color }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums w-4">
                    {nw.length || ''}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <p className="font-mono text-[10px] text-muted-foreground/50">
          {total} cases with warranty field · grows as judgments are harvested
        </p>
      </CardContent>
    </Card>
  );
}
