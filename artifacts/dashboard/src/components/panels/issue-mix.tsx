import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

// Palette assigned dynamically to whatever issue_type values the active
// taxonomy (scraper/taxonomy.py) actually produces — not hardcoded to any
// one industry's category names.
const CHART_PALETTE = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2, 210 100% 60%))',
  'hsl(var(--chart-3, 280 80% 60%))',
  'hsl(var(--chart-4, 340 80% 60%))',
  'hsl(var(--chart-5, 40 90% 60%))',
  'hsl(var(--chart-1, 160 60% 45%))',
  'hsl(var(--chart-2, 30 80% 55%))',
];
const OTHER_COLOR = 'hsl(var(--muted-foreground))';

/** Assign a stable palette color to each category name; "Other" always gets the muted catch-all color. */
function colorForCategories(names: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  const rest = [...new Set(names)].filter((n) => n !== 'Other').sort();
  rest.forEach((name, i) => { colors[name] = CHART_PALETTE[i % CHART_PALETTE.length]; });
  if (names.includes('Other')) colors['Other'] = OTHER_COLOR;
  return colors;
}

export function IssueMix({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { data, extracted, isSample, colors } = useMemo(() => {
    const extracted = cases.filter((c) => c.issue_type && c.extraction_status !== 'low_confidence');
    const counts: Record<string, Case[]> = {};
    for (const c of extracted) {
      const k = c.issue_type!;
      if (!counts[k]) counts[k] = [];
      counts[k].push(c);
    }
    const data = Object.entries(counts)
      .map(([name, rows]) => ({ name, count: rows.length, rows }))
      .sort((a, b) => b.count - a.count);
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    const colors = colorForCategories(data.map((d) => d.name));
    return { data, extracted, isSample, colors };
  }, [cases]);

  if (extracted.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Issue mix</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-sm text-muted-foreground/50 text-center px-4">
          Extraction pending — run <code className="mx-1 text-primary/70">python3 scraper/extract.py --sample 20</code> to populate
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Issue mix</CardTitle>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground/60">{extracted.length} extracted</span>
          {isSample && <SampleTag />}
        </div>
      </CardHeader>
      <CardContent className="pt-2 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 12 }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
            />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} cursor="pointer"
              onClick={(d) => openDrawer(`Issue: ${d.name} — ${d.count} cases`, d.rows)}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={colors[entry.name] ?? 'hsl(var(--primary))'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
