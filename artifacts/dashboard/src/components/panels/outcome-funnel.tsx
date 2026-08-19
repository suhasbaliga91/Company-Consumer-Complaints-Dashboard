import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

// OEM's perspective: Dismissed/Ex-parte = good (teal); Allowed = bad (coral)
const OUTCOME_COLORS: Record<string, string> = {
  'Dismissed':           'hsl(174 62% 38%)',   // teal — OEM won
  'Ex-parte':            'hsl(174 62% 55%)',   // lighter teal — OEM won (ex-parte)
  'Allowed':             'hsl(9 78% 58%)',     // coral — OEM lost
  'Partially Allowed':   'hsl(9 78% 72%)',     // lighter coral — OEM lost partially
  'Remanded':            'hsl(38 95% 49%)',    // amber
  'Settled / Withdrawn': 'hsl(245 58% 51%)',   // indigo
  'Other':               'hsl(var(--muted-foreground))',
};

export function OutcomeFunnel({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { data, total, isSample } = useMemo(() => {
    const counts: Record<string, Case[]> = {};
    for (const c of cases) {
      if (!c.outcome || c.extraction_status === 'low_confidence') continue;
      if (!counts[c.outcome]) counts[c.outcome] = [];
      counts[c.outcome].push(c);
    }
    const data = Object.entries(counts)
      .map(([outcome, caseList]) => ({ outcome, count: caseList.length, caseList }))
      .sort((a, b) => b.count - a.count);
    const total = data.reduce((s, d) => s + d.count, 0);
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    return { data, total, isSample };
  }, [cases]);

  if (total === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Outcome funnel</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[280px] text-xs text-muted-foreground/50">Extraction pending</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Outcome funnel</CardTitle>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground/60">{total} extracted</span>
          {isSample && <SampleTag />}
        </div>
      </CardHeader>
      <CardContent className="pt-2 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 40, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="outcome" width={130} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 12 }}
              formatter={(v: number) => [`${v} (${Math.round((v / total) * 100)}%)`, 'Cases']}
            />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} cursor="pointer"
              onClick={(d) => openDrawer(`Outcome: ${d.outcome} — ${d.count} cases`, d.caseList)}
            >
              {data.map((entry) => (
                <Cell key={entry.outcome} fill={OUTCOME_COLORS[entry.outcome] ?? 'hsl(var(--primary))'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
