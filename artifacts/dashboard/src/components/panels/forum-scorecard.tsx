import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props { cases: Case[] }

function fmt(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

type SortKey = 'fav_pct' | 'dis_pct' | 'cases' | 'avg_award' | 'med_claim';

const PAGE_SIZE = 20;

export function ForumScorecard({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [sortKey, setSortKey] = useState<SortKey>('fav_pct');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const commMap: Record<string, Case[]> = {};
    for (const c of cases) {
      const key = c.commission || 'Unknown';
      if (!commMap[key]) commMap[key] = [];
      commMap[key].push(c);
    }

    return Object.entries(commMap)
      .filter(([, caseList]) => caseList.length > 1) // skip 1-case forums
      .map(([commission, caseList]) => {
        const withOutcome = caseList.filter(c => c.outcome);
        // fav_pct = OEM's win rate (Dismissed/Ex-parte); dis_pct = complaint allowed rate
        const fav = withOutcome.filter(c => c.outcome && (c.outcome.includes('Dismiss') || c.outcome.includes('Ex-parte'))).length;
        const dis = withOutcome.filter(c => c.outcome && c.outcome.includes('Allowed')).length;
        const fav_pct = withOutcome.length > 0 ? Math.round((fav / withOutcome.length) * 100) : 0; // OEM win %
        const dis_pct = withOutcome.length > 0 ? Math.round((dis / withOutcome.length) * 100) : 0; // allowed %

        const awards = caseList.filter(c => c.amount_awarded != null).map(c => c.amount_awarded!);
        const claims = caseList.filter(c => c.claim_amount != null).map(c => c.claim_amount!);
        const avg_award = awards.length > 0 ? awards.reduce((s, v) => s + v, 0) / awards.length : null;
        const med_claim = claims.length > 0 ? median(claims) : null;

        const level = caseList[0]?.level ?? 'district';
        return { commission, level, cases: caseList.length, fav_pct, dis_pct, avg_award, med_claim, caseList };
      });
  }, [cases]);

  const sorted = useMemo(() => {
    const levelOrder: Record<string, number> = { national: 0, state: 1, district: 2 };
    return [...rows].sort((a, b) => {
      // Primary: level order
      const lv = (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3);
      if (lv !== 0) return lv;
      // Secondary: chosen sort column
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); setPage(0); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="opacity-20">↕</span>;
    return sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  }

  const LEVEL_BADGE: Record<string, string> = {
    national: 'bg-amber-50 text-amber-700 border-amber-200',
    state:    'bg-blue-50 text-blue-700 border-blue-200',
    district: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground">Forum Scorecard</CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground/60">{sorted.length} forums · {rows.length < (cases.reduce((s, c, _, arr) => { const k = new Set(arr.map(x => x.commission)); return k.size; }, 0)) ? '' : ''}excluding single-case</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col p-0 pb-2">
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="border-b border-border">
                <th className="text-left font-semibold text-muted-foreground py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider">Commission</th>
                <th className="text-right font-semibold text-muted-foreground py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort('cases')}>
                  Cases <SortIcon col="cases" />
                </th>
                <th className="text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer hover:text-foreground select-none" style={{ color: 'hsl(174 62% 38%)' }} onClick={() => toggleSort('fav_pct')}>
                  Won% <SortIcon col="fav_pct" />
                </th>
                <th className="text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer hover:text-foreground select-none" style={{ color: 'hsl(9 78% 58%)' }} onClick={() => toggleSort('dis_pct')}>
                  Lost% <SortIcon col="dis_pct" />
                </th>
                <th className="text-right font-semibold text-muted-foreground py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort('avg_award')}>
                  Avg Award <SortIcon col="avg_award" />
                </th>
                <th className="text-right font-semibold text-muted-foreground py-2 pl-2 pr-4 text-[10px] uppercase tracking-wider cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort('med_claim')}>
                  Med Claim <SortIcon col="med_claim" />
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => (
                <tr
                  key={row.commission}
                  className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                  onClick={() => openDrawer(`${row.commission} — ${row.cases} cases`, row.caseList)}
                >
                  <td className="py-1.5 pl-4 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[8px] px-1 py-0 rounded border font-mono uppercase ${LEVEL_BADGE[row.level] ?? LEVEL_BADGE.district}`}>
                        {row.level === 'national' ? 'NCDRC' : row.level === 'state' ? 'State' : 'Dist.'}
                      </span>
                      <span className="font-mono text-foreground text-[10px] truncate max-w-[160px]" title={row.commission}>{row.commission}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 font-mono text-right text-muted-foreground">{row.cases.toLocaleString()}</td>
                  <td className="py-1.5 px-2 font-mono text-right">
                    {/* fav_pct = OEM's win rate — higher is better (teal) */}
                    <span style={{ color: row.fav_pct >= 50 ? 'hsl(174 62% 38%)' : row.fav_pct >= 25 ? 'hsl(38 95% 49%)' : 'hsl(var(--muted-foreground))' }} className={row.fav_pct >= 50 ? 'font-semibold' : ''}>
                      {row.fav_pct}%
                    </span>
                  </td>
                  <td className="py-1.5 px-2 font-mono text-right" style={{ color: 'hsl(9 78% 58%)' }}>{row.dis_pct}%</td>
                  {/* dis_pct = complaint allowed rate — higher is worse (coral) */}
                  <td className="py-1.5 px-2 font-mono text-right text-muted-foreground">{row.avg_award != null ? fmt(row.avg_award) : '—'}</td>
                  <td className="py-1.5 pl-2 pr-4 font-mono text-right text-muted-foreground">{row.med_claim != null ? fmt(row.med_claim) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 pt-2 border-t border-border/40 flex-shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
