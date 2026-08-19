import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

export function FilingCohorts({ cases }: { cases: Case[] }) {
  const { lens, openDrawer } = useDashboard();

  const data = useMemo(() => {
    if (!cases) return [];

    const pendingByYear: Record<number, Case[]> = {};
    cases.forEach(c => {
      if (!c.filing_date) return;
      if (c.canonical_stage === 'Disposed') return;
      const year = parseInt(c.filing_date.substring(0, 4));
      if (isNaN(year) || year < 2010 || year > 2026) return;
      if (!pendingByYear[year]) pendingByYear[year] = [];
      pendingByYear[year].push(c);
    });

    const years = Object.keys(pendingByYear).map(Number).sort((a, b) => a - b);
    if (years.length === 0) return [];

    const minYear = Math.min(...years, 2015);
    const maxYear = Math.max(...years, 2026);

    let cumulative = 0;
    const result: { year: string; cumulative: number; added: number; cases: Case[] }[] = [];

    for (let y = minYear; y <= maxYear; y++) {
      const yearCases = pendingByYear[y] || [];
      cumulative += yearCases.length;
      result.push({ year: y.toString(), cumulative, added: yearCases.length, cases: yearCases });
    }

    return result;
  }, [cases]);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Filing cohorts</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  const handleClick = (payload: any) => {
    if (!payload?.activePayload?.[0]) return;
    const { year, cases: yearCases } = payload.activePayload[0].payload as { year: string; cumulative: number; cases: Case[] };
    openDrawer(`Filed in ${year} — ${yearCases.length} pending cases`, yearCases);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{
        background: '#fff',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: 12,
        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
      }}>
        <div style={{ color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>{label}</div>
        <div style={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}>
          {d.cumulative.toLocaleString()} cumulative
        </div>
        {d.added > 0 && (
          <div style={{ color: '#3b82f6', marginTop: 2 }}>+{d.added.toLocaleString()} that year</div>
        )}
      </div>
    );
  };

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Filing cohorts</CardTitle>
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">Cumulative pending</span>
      </CardHeader>
      <CardContent className="flex-1 pb-4 pt-0">
        <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[320px] h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
            onClick={handleClick}
            className="cursor-pointer"
          >
            <defs>
              <linearGradient id="cohortGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'monospace' }}
              dy={6}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'monospace' }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 2' }} />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#cohortGrad)"
              dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
