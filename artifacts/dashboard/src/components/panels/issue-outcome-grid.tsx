import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

// OEM's perspective: Dismissed→teal (good), Allowed→coral (bad)
const OUTCOME_COLORS: Record<string, string> = {
  Dismissed:           'hsl(174 62% 38%)',   // teal — OEM won
  Allowed:             'hsl(9 78% 58%)',     // coral — OEM lost
  'Settled/Withdrawn': 'hsl(245 58% 51%)',  // indigo
  Remanded:            'hsl(38 95% 49%)',    // amber
  Other:               'hsl(var(--muted-foreground))',
};

function bucketOutcome(outcome: string | null | undefined): string {
  if (!outcome) return 'Other';
  const o = outcome.toLowerCase();
  if (o.includes('allow')) return 'Allowed';
  if (o.includes('dismiss') || o.includes('ex-parte')) return 'Dismissed';
  if (o.includes('settle') || o.includes('withdrawn')) return 'Settled/Withdrawn';
  if (o.includes('remand')) return 'Remanded';
  return 'Other';
}

export function IssueOutcomeGrid({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const data = useMemo(() => {
    const issueMap: Record<string, Record<string, Case[]>> = {};

    for (const c of cases) {
      const issue = c.issue_type ?? 'Unknown';
      const bucket = bucketOutcome(c.outcome);
      if (!issueMap[issue]) issueMap[issue] = {};
      if (!issueMap[issue][bucket]) issueMap[issue][bucket] = [];
      issueMap[issue][bucket].push(c);
    }

    const bucketOrder = ['Dismissed', 'Allowed', 'Settled/Withdrawn', 'Remanded', 'Other'];

    return Object.entries(issueMap)
      .map(([issue, buckets]) => {
        const total = Object.values(buckets).reduce((s, arr) => s + arr.length, 0);
        const row: Record<string, unknown> = { issue: issue.length > 30 ? issue.slice(0, 28) + '…' : issue, issueRaw: issue, total };
        for (const b of bucketOrder) {
          row[b] = buckets[b]?.length ?? 0;
          row[`${b}_cases`] = buckets[b] ?? [];
        }
        return row as {
          issue: string; issueRaw: string; total: number;
          Dismissed: number; Allowed: number; 'Settled/Withdrawn': number; Remanded: number; Other: number;
          [k: string]: unknown;
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [cases]);

  if (data.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Issue × Outcome</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-64 text-xs text-muted-foreground/50">Extraction pending</CardContent>
      </Card>
    );
  }

  const bucketOrder = ['Dismissed', 'Allowed', 'Settled/Withdrawn', 'Remanded', 'Other'];

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-semibold text-foreground">Issue × Outcome</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 4, right: 16, top: 0, bottom: 0 }}
            barSize={12}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="issue" width={160} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}
            />
            <Legend formatter={(v) => <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>{v}</span>} iconSize={8} />
            {bucketOrder.map(bucket => (
              <Bar
                key={bucket}
                dataKey={bucket}
                stackId="a"
                fill={OUTCOME_COLORS[bucket]}
                cursor="pointer"
                onClick={(d) => openDrawer(`${d.issueRaw} — ${bucket}`, (d[`${bucket}_cases`] as Case[]) ?? [])}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
