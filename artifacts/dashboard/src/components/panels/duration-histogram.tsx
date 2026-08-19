import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Case } from '@workspace/api-client-react';
import { differenceInDays, startOfDay } from 'date-fns';

interface Props { cases: Case[] }

const BUCKETS = [
  { label: '<1 yr',  min: 0,    max: 365 },
  { label: '1–2 yr', min: 365,  max: 730 },
  { label: '2–3 yr', min: 730,  max: 1095 },
  { label: '3–4 yr', min: 1095, max: 1460 },
  { label: '4–5 yr', min: 1460, max: 1825 },
  { label: '5–7 yr', min: 1825, max: 2555 },
  { label: '7–10 yr',min: 2555, max: 3650 },
  { label: '>10 yr', min: 3650, max: Infinity },
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function DurationHistogram({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { histData, medianDays, meanDays, total } = useMemo(() => {
    const today = startOfDay(new Date());
    const casesByBucket: Map<number, Case[]> = new Map(BUCKETS.map((_, i) => [i, []]));
    const allDays: number[] = [];

    for (const c of cases) {
      if (!c.filing_date) continue;
      const days = differenceInDays(today, new Date(c.filing_date));
      if (days <= 0) continue;
      allDays.push(days);
      for (let i = 0; i < BUCKETS.length; i++) {
        if (days >= BUCKETS[i].min && days < BUCKETS[i].max) {
          casesByBucket.get(i)!.push(c);
          break;
        }
      }
    }

    const histData = BUCKETS.map((b, i) => ({
      label: b.label,
      count: casesByBucket.get(i)!.length,
      cases: casesByBucket.get(i)!,
      midpoint: (b.min + Math.min(b.max, b.min + 730)) / 2,
    }));

    return {
      histData,
      medianDays: allDays.length > 0 ? Math.round(median(allDays)) : null,
      meanDays:   allDays.length > 0 ? Math.round(mean(allDays))   : null,
      total: allDays.length,
    };
  }, [cases]);

  // Convert days to bucket index for reference lines
  function daysToLabel(days: number): string {
    for (const b of BUCKETS) {
      if (days >= b.min && days < b.max) return b.label;
    }
    return BUCKETS[BUCKETS.length - 1].label;
  }

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Duration Histogram</CardTitle>
        {total > 0 && (
          <div className="flex gap-3 text-[10px] font-mono text-muted-foreground/70">
            {medianDays && <span className="text-amber-600">Median: {(medianDays / 365).toFixed(1)} yr</span>}
            {meanDays   && <span>Mean: {(meanDays / 365).toFixed(1)} yr</span>}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col gap-2 pt-2">
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/50">No filing date data</div>
        ) : (
          <>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}
                    formatter={(v: number) => [v, 'Cases']}
                  />
                  {medianDays && (
                    <ReferenceLine
                      x={daysToLabel(medianDays)}
                      stroke="hsl(40 80% 55%)"
                      strokeDasharray="4 4"
                      label={{ value: 'Median', position: 'top', fontSize: 9, fill: 'hsl(40 80% 55%)', fontFamily: 'monospace' }}
                    />
                  )}
                  <Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    radius={[3, 3, 0, 0]}
                    opacity={0.8}
                    cursor="pointer"
                    onClick={(d) => openDrawer(`Duration ${d.label} — ${d.count} cases`, d.cases)}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground/50 text-center flex-shrink-0">
              {total} cases with filing dates · duration = filing → present (no closure date recorded)
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
