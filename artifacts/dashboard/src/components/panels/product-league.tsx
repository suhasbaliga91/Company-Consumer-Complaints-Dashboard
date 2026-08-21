import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

export function ProductLeague({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { rows, isSample } = useMemo(() => {
    const counts: Record<string, Case[]> = {};
    for (const c of cases) {
      if (!c.product_model || c.extraction_status === 'low_confidence') continue;
      const k = c.product_model;
      if (!counts[k]) counts[k] = [];
      counts[k].push(c);
    }
    const rows = Object.entries(counts)
      .map(([model, cases]) => ({ model, count: cases.length, cases }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    return { rows, isSample };
  }, [cases]);

  if (rows.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">Product League</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-xs text-muted-foreground/50 font-mono">Extraction pending</CardContent>
      </Card>
    );
  }

  const max = rows[0].count;

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">Product League</CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent className="pt-0 overflow-y-auto max-h-[220px]">
        <div className="flex flex-col gap-1.5">
          {rows.map(({ model, count, cases: modelCases }, i) => (
            <button key={model}
              onClick={() => openDrawer(`${model} — ${count} cases`, modelCases)}
              className="flex items-center gap-2 group text-left hover:bg-muted/20 rounded px-1 py-0.5 transition-colors"
            >
              <span className="font-mono text-[10px] text-muted-foreground/50 w-4 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-foreground truncate">{model}</div>
                <div className="h-1 bg-muted/30 rounded-full mt-0.5">
                  <div className="h-1 bg-primary rounded-full transition-all" style={{ width: `${(count / max) * 100}%` }} />
                </div>
              </div>
              <span className="font-mono text-xs text-primary tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
