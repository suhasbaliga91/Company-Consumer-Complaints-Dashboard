import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

export function FilingYearDistribution({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { data, medianYear } = useMemo(() => {
    const yearMap: Record<number, Case[]> = {};

    for (const c of cases) {
      if (!c.filing_date) continue;
      const yr = parseInt(c.filing_date.substring(0, 4));
      if (isNaN(yr) || yr < 2010 || yr > 2030) continue;
      if (!yearMap[yr]) yearMap[yr] = [];
      yearMap[yr].push(c);
    }

    const data = Object.entries(yearMap)
      .map(([yr, caseList]) => ({ year: parseInt(yr), count: caseList.length, cases: caseList }))
      .sort((a, b) => a.year - b.year);

    // Median filing year (by case weight)
    const allYears = data.flatMap(d => Array(d.count).fill(d.year));
    allYears.sort((a, b) => a - b);
    const mid = Math.floor(allYears.length / 2);
    const medianYear = allYears.length > 0 ? allYears[mid] : null;

    return { data, medianYear };
  }, [cases]);

  if (data.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Filing Year</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-64 text-xs text-muted-foreground/50">No filing date data</CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...data.map(d => d.count));

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Filing Year</CardTitle>
        <div className="text-[10px] font-mono text-muted-foreground/70">
          {data.length} cohorts · median {medianYear}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col gap-2 pt-2">
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}
                formatter={(v: number) => [v, 'Disposed cases filed this year']}
                labelFormatter={(yr) => `Year ${yr}`}
              />
              <Bar
                dataKey="count"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(d) => openDrawer(`Filed in ${d.year} — ${d.count} disposed cases`, d.cases)}
              >
                {data.map((d) => (
                  <Cell
                    key={d.year}
                    fill={d.year === medianYear ? 'hsl(40 80% 55%)' : `rgba(59,130,246,${0.3 + (d.count / maxCount) * 0.7})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/50 text-center flex-shrink-0">
          When disposed cases were originally filed · amber bar = median year
        </p>
      </CardContent>
    </Card>
  );
}
