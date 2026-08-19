import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, LineChart, Line, CartesianGrid, Cell,
} from 'recharts';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

function fmt(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

/** Parse a filing_date string like "2019-07-15" → year number, or null. */
function parseYear(d: string | null | undefined): number | null {
  if (!d) return null;
  const y = parseInt(d.slice(0, 4), 10);
  return isNaN(y) || y < 2010 || y > 2030 ? null : y;
}

// OEM's perspective: Dismissed→teal (won), Allowed→coral (lost), Settled→amber
function dotColor(outcome: string | null | undefined): string {
  if (!outcome) return 'hsl(var(--muted-foreground))';
  const o = outcome.toLowerCase();
  if (o.includes('dismiss') || o.includes('ex-parte')) return 'hsl(174 62% 38%)'; // teal — OEM won
  if (o.includes('allow')) return 'hsl(9 78% 58%)';                               // coral — OEM lost
  if (o.includes('settle') || o.includes('withdrawn')) return 'hsl(38 95% 49%)';  // amber
  return 'hsl(var(--primary))';
}

export function ClaimedAwarded({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { points, stats, trendRows, isSample, missingCount } = useMemo(() => {
    const points = cases
      .filter((c) => c.claim_amount != null && c.amount_awarded != null && c.extraction_status !== 'low_confidence')
      .map((c) => ({
        x: c.claim_amount!,
        y: c.amount_awarded!,
        case: c,
        name: c.case_number,
        outcome: c.outcome ?? null,
      }));

    const missingCount = cases.filter(
      (c) => c.claim_amount == null || c.amount_awarded == null
    ).length;

    if (points.length === 0) return { points: [], stats: null, trendRows: [], isSample: false, missingCount };

    const totalClaimed  = points.reduce((s, p) => s + p.x, 0);
    const totalAwarded  = points.reduce((s, p) => s + p.y, 0);
    const recoveryRate  = totalClaimed > 0 ? Math.round((totalAwarded / totalClaimed) * 100) : 0;

    // ── Recovery ratio trend by filing year ──────────────────────────
    const byYear: Record<number, { ratios: number[] }> = {};
    for (const c of cases) {
      if (
        c.claim_amount == null || c.claim_amount <= 0 ||
        c.amount_awarded == null ||
        c.extraction_status === 'low_confidence'
      ) continue;
      const yr = parseYear(c.filing_date);
      if (!yr) continue;
      if (!byYear[yr]) byYear[yr] = { ratios: [] };
      byYear[yr].ratios.push(Math.min((c.amount_awarded / c.claim_amount) * 100, 100));
    }
    const trendRows = Object.entries(byYear)
      .map(([yr, { ratios }]) => ({
        year: parseInt(yr, 10),
        ratio: Math.round(ratios.reduce((s, r) => s + r, 0) / ratios.length),
        n: ratios.length,
      }))
      .filter((r) => r.n >= 1)
      .sort((a, b) => a.year - b.year);
    // ─────────────────────────────────────────────────────────────────

    const isSample =
      cases.some((c) => c.extraction_status === 'sample') &&
      !cases.some((c) => c.extraction_status === 'full');

    return { points, stats: { totalClaimed, totalAwarded, recoveryRate, n: points.length }, trendRows, isSample, missingCount };
  }, [cases]);

  if (points.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Claimed vs Awarded</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
          Extraction pending
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Claimed vs Awarded</CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/20 rounded p-2 text-center">
            <div className="font-mono text-xs text-muted-foreground">Total Claimed</div>
            <div className="font-mono text-sm font-bold text-foreground">{fmt(stats!.totalClaimed)}</div>
          </div>
          <div className="bg-muted/20 rounded p-2 text-center">
            <div className="font-mono text-xs text-muted-foreground">Total Awarded</div>
            <div className="font-mono text-sm font-bold text-primary">{fmt(stats!.totalAwarded)}</div>
          </div>
          <div className="bg-muted/20 rounded p-2 text-center">
            <div className="font-mono text-xs text-muted-foreground">Recovery Rate</div>
            <div className="font-mono text-sm font-bold text-foreground">{stats!.recoveryRate}%</div>
          </div>
        </div>

        {/* Scatter plot — horizontal scroll on small screens */}
        <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[320px] h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
              <XAxis
                type="number" dataKey="x" name="Claimed" tickFormatter={(v) => fmt(v)}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                type="number" dataKey="y" name="Awarded" tickFormatter={(v) => fmt(v)}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))',
                  borderRadius: 6, fontFamily: 'monospace', fontSize: 11,
                }}
                formatter={(v: number, name: string) => [fmt(v), name]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ''}
              />
              <ReferenceLine
                stroke="hsl(var(--border))" strokeDasharray="4 4"
                segment={[
                  { x: 0, y: 0 },
                  { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.x)) },
                ]}
              />
              <Scatter
                data={points} opacity={0.7}
                onClick={(d) => openDrawer(`${d.name}`, [d.case])} cursor="pointer"
              >
                {points.map((p, i) => (
                  <Cell key={i} fill={dotColor(p.outcome)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        </div>

        {/* Legend + footer note */}
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(174 62% 38%)' }} />OEM won
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(9 78% 58%)' }} />OEM lost
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(38 95% 49%)' }} />Settled
          </span>
          <span className="ml-auto">
            {stats!.n} cases with data{missingCount > 0 ? ` · ${missingCount} missing data` : ''} · diagonal = full recovery
          </span>
        </div>

        {/* Recovery ratio trend by year */}
        {trendRows.length >= 2 && (
          <>
            <div className="border-t border-border/40 pt-3">
              <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
                Avg recovery ratio by filing year
              </div>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendRows} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      unit="%" domain={[0, 100]}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))',
                        borderRadius: 6, fontFamily: 'monospace', fontSize: 11,
                      }}
                      formatter={(v: number, _: string, props: { payload?: { n?: number } }) => [
                        `${v}%`,
                        `Recovery (n=${props.payload?.n ?? '?'})`,
                      ]}
                      labelFormatter={(yr) => `Filed ${yr}`}
                    />
                    <Line
                      type="monotone" dataKey="ratio"
                      stroke="hsl(var(--primary))" strokeWidth={2}
                      dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground/50 text-center mt-1">
                Award as % of claim · grows as more judgments are harvested
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
