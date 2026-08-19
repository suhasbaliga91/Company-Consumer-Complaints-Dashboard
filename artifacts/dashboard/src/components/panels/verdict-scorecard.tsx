import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

// Colour palette from OEM's perspective: Dismissed→teal (good), Allowed→coral (bad)
const BUCKET_COLORS: Record<string, string> = {
  'Dismissed':          'hsl(174 62% 38%)',   // teal — OEM won
  'Allowed':            'hsl(9 78% 58%)',     // coral — OEM lost
  'Settled/Withdrawn':  'hsl(245 58% 51%)',   // indigo
  'Remanded':           'hsl(38 95% 49%)',    // amber
  'Other':              'hsl(var(--muted-foreground))',
  'Extraction Pending': 'hsl(var(--border))',
};

function bucketOutcome(outcome: string | null | undefined): string {
  if (!outcome) return 'Extraction Pending';
  const o = outcome.toLowerCase();
  if (o.includes('allow')) return 'Allowed';
  if (o.includes('dismiss') || o.includes('ex-parte')) return 'Dismissed';
  if (o.includes('settle') || o.includes('withdrawn')) return 'Settled/Withdrawn';
  if (o.includes('remand')) return 'Remanded';
  return 'Other';
}

const FORUM_LABELS: Record<string, string> = {
  national: 'National Commission',
  state:    'State Commission',
  district: 'District Forum',
};

export function VerdictScorecard({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const { pie, pendingCases, forumRows } = useMemo(() => {
    const bucketMap: Record<string, Case[]> = {};
    for (const c of cases) {
      const b = bucketOutcome(c.outcome);
      if (!bucketMap[b]) bucketMap[b] = [];
      bucketMap[b].push(c);
    }

    const pendingCases = bucketMap['Extraction Pending'] ?? [];

    const order = ['Dismissed', 'Allowed', 'Settled/Withdrawn', 'Remanded', 'Other'];
    const pie = order
      .filter(b => bucketMap[b]?.length)
      .map(b => ({ name: b, value: bucketMap[b].length, cases: bucketMap[b] }));

    // Forum breakdown
    const forumMap: Record<string, Record<string, Case[]>> = {};
    for (const c of cases) {
      const level = c.level ?? 'district';
      const b = bucketOutcome(c.outcome);
      if (!forumMap[level]) forumMap[level] = {};
      if (!forumMap[level][b]) forumMap[level][b] = [];
      forumMap[level][b].push(c);
    }

    const forumOrder = ['national', 'state', 'district'];
    const forumRows = forumOrder
      .filter(lv => forumMap[lv])
      .map(lv => {
        const buckets = forumMap[lv];
        const total = Object.values(buckets).reduce((s, arr) => s + arr.length, 0);
        const favCount = (buckets['Allowed'] ?? []).length;
        const disCount = (buckets['Dismissed'] ?? []).length;
        const pendCount = (buckets['Extraction Pending'] ?? []).length;
        const levelCases = cases.filter(c => (c.level ?? 'district') === lv);
        return { level: lv, label: FORUM_LABELS[lv], total, favCount, disCount, pendCount, levelCases };
      });

    return { pie, pendingCases, forumRows };
  }, [cases]);

  const total = pie.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-semibold text-foreground">Verdict Scorecard</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col gap-3">
        {/* Donut chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pie}
                cx="50%"
                cy="50%"
                innerRadius="52%"
                outerRadius="80%"
                paddingAngle={2}
                dataKey="value"
                onClick={(d) => openDrawer(`${d.name} — ${d.value} cases`, d.cases)}
                cursor="pointer"
              >
                {pie.map((entry) => (
                  <Cell key={entry.name} fill={BUCKET_COLORS[entry.name] ?? 'hsl(var(--primary))'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid hsl(var(--border))', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
                formatter={(v: number) => [`${v} (${Math.round((v / total) * 100)}%)`, 'Cases']}
              />
              <Legend
                formatter={(value) => <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Extraction pending note */}
        {pendingCases.length > 0 && (
          <button
            className="text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground text-left leading-tight"
            onClick={() => openDrawer(`Extraction Pending — ${pendingCases.length} cases`, pendingCases)}
          >
            + {pendingCases.length} cases — outcome not yet extracted
          </button>
        )}

        {/* Forum breakdown table */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-semibold text-muted-foreground pb-1 text-[10px] uppercase tracking-wider">Forum</th>
                <th className="text-right font-semibold text-muted-foreground pb-1 text-[10px] uppercase tracking-wider">Total</th>
                <th className="text-right font-semibold pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'hsl(174 62% 38%)' }}>Dis.</th>
                <th className="text-right font-semibold pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'hsl(9 78% 58%)' }}>Allowed</th>
                <th className="text-right font-semibold text-muted-foreground pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Pend.</th>
              </tr>
            </thead>
            <tbody>
              {forumRows.map(row => (
                <tr
                  key={row.level}
                  className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                  onClick={() => openDrawer(`${row.label} — ${row.total} cases`, row.levelCases)}
                >
                  <td className="py-1.5 font-mono text-foreground">{row.label}</td>
                  <td className="py-1.5 font-mono text-right text-muted-foreground">{row.total.toLocaleString()}</td>
                  <td className="py-1.5 font-mono text-right" style={{ color: 'hsl(174 62% 38%)' }}>{row.disCount}</td>
                  <td className="py-1.5 font-mono text-right" style={{ color: 'hsl(9 78% 58%)' }}>{row.favCount}</td>
                  <td className="py-1.5 font-mono text-right text-muted-foreground/50">{row.pendCount > 0 ? row.pendCount : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
