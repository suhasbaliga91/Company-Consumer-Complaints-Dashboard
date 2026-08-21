import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

// OEM's perspective: Dismissed/Ex-parte = OEM won; Allowed = OEM lost
const OEM_WON_OUTCOMES  = new Set(['Dismissed', 'Ex-parte']);
const OEM_LOST_OUTCOMES = new Set(['Allowed', 'Partially Allowed']);

export function ProductOutcomes({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const rows = useMemo(() => {
    const modelMap: Record<string, Case[]> = {};
    for (const c of cases) {
      const model = c.product_model?.trim();
      if (!model) continue;
      if (!modelMap[model]) modelMap[model] = [];
      modelMap[model].push(c);
    }
    return Object.entries(modelMap)
      .filter(([, cl]) => cl.length > 1)
      .map(([model, caseList]) => {
        const withOutcome = caseList.filter(c => c.outcome);
        const won = withOutcome.filter(c => c.outcome && OEM_WON_OUTCOMES.has(c.outcome)).length;
        const lost = withOutcome.filter(c => c.outcome && OEM_LOST_OUTCOMES.has(c.outcome)).length;
        const decided = won + lost;
        const win_pct = decided > 0 ? Math.round((won / decided) * 100) : null;
        // keep fav/dis aliases for bar widths
        const fav = won; const dis = lost; const fav_pct = win_pct;
        const avgClaim = caseList.filter(c => c.claim_amount != null).length > 0
          ? Math.round(caseList.filter(c => c.claim_amount != null).reduce((s, c) => s + c.claim_amount!, 0) / caseList.filter(c => c.claim_amount != null).length)
          : null;
        return { model, total: caseList.length, fav, dis, win_pct, fav_pct, avgClaim, caseList };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  }, [cases]);

  function fmt(n: number): string {
    if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
    if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
    if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
    return `₹${n}`;
  }

  if (rows.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Product Outcomes</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-xs text-muted-foreground/50">Extraction pending</CardContent>
      </Card>
    );
  }

  const maxTotal = rows[0]?.total || 1;

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-semibold text-foreground">Product Outcomes</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
        <div className="flex flex-col gap-2.5">
          {rows.map(row => {
            const favWidth = row.total > 0 ? (row.fav / row.total) * 100 : 0;
            const disWidth = row.total > 0 ? (row.dis / row.total) * 100 : 0;
            const otherWidth = 100 - favWidth - disWidth;

            return (
              <div key={row.model} className="cursor-pointer group" onClick={() => openDrawer(`${row.model} — ${row.total} cases`, row.caseList)}>
                <div className="flex items-baseline justify-between mb-0.5 gap-2">
                  <span className="font-mono text-[10px] text-foreground font-medium">{row.model}</span>
                  <span className="font-mono text-[9px] text-muted-foreground/60 flex-shrink-0">
                    {row.total} cases
                    {row.win_pct != null && <> · <span style={{ color: 'hsl(174 62% 38%)' }}>{row.win_pct}% OEM won</span></>}
                    {row.avgClaim != null && <> · {fmt(row.avgClaim)} avg claim</>}
                  </span>
                </div>
                <div className="flex h-4 rounded overflow-hidden gap-0.5">
                  {favWidth > 0 && (
                    <div className="h-full opacity-75 group-hover:opacity-90 transition-opacity"
                      style={{ width: `${favWidth}%`, background: 'hsl(174 62% 38%)' }} title={`${row.fav} dismissed (OEM won)`} />
                  )}
                  {disWidth > 0 && (
                    <div className="h-full opacity-75 group-hover:opacity-90 transition-opacity"
                      style={{ width: `${disWidth}%`, background: 'hsl(9 78% 58%)' }} title={`${row.dis} allowed (OEM lost)`} />
                  )}
                  {otherWidth > 0 && (
                    <div className="h-full bg-muted border border-border/40 opacity-60"
                      style={{ width: `${otherWidth}%` }} title="Other / pending" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
