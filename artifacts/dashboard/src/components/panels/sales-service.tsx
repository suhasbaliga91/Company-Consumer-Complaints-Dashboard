import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

const COLORS = { Sales: 'hsl(var(--primary))', Service: 'hsl(var(--chart-3, 340 80% 60%))' };

export function SalesService({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { data, total, isSample } = useMemo(() => {
    const groups: Record<string, Case[]> = { Sales: [], Service: [] };
    for (const c of cases) {
      if (c.extraction_status === 'low_confidence') continue;
      if (c.sales_or_service === 'Sales') groups.Sales.push(c);
      else if (c.sales_or_service === 'Service') groups.Service.push(c);
    }
    const data = Object.entries(groups)
      .filter(([, rows]) => rows.length > 0)
      .map(([name, rows]) => ({ name, value: rows.length, rows }));
    const total = data.reduce((s, d) => s + d.value, 0);
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    return { data, total, isSample };
  }, [cases]);

  if (total === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">Sales vs Service</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-xs text-muted-foreground/50 font-mono">Extraction pending</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-1 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">Sales vs Service</CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent className="h-[200px] pt-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}
              onClick={(d) => openDrawer(`${d.name} — ${d.value} cases`, d.rows)} cursor="pointer"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS] ?? 'hsl(var(--muted))'} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
