import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';

interface Props { cases: Case[] }

function fmt(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

const PAGE_SIZE = 20;

type SortKey = 'advocate' | 'total' | 'fav' | 'dis' | 'fav_pct';

export function ComplainantCounsel({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortAsc, setSortAsc] = useState(false);

  const baseRows = useMemo(() => {
    const advMap: Record<string, Case[]> = {};

    for (const c of cases) {
      const adv = c.comp_advocate?.trim();
      if (!adv) continue;
      if (!advMap[adv]) advMap[adv] = [];
      advMap[adv].push(c);
    }

    return Object.entries(advMap)
      .filter(([, cl]) => cl.length > 1)
      .map(([advocate, caseList]) => {
        const withOutcome = caseList.filter(c => c.outcome);
        const fav = withOutcome.filter(c => c.outcome && c.outcome.includes('Allowed')).length;
        const dis = withOutcome.filter(c => c.outcome && (c.outcome.includes('Dismiss') || c.outcome.includes('Ex-parte'))).length;
        const fav_pct = withOutcome.length > 0 ? Math.round((fav / withOutcome.length) * 100) : null;

        const totalClaimed = caseList
          .filter(c => c.claim_amount != null)
          .reduce((s, c) => s + c.claim_amount!, 0);

        const states = Array.from(new Set(caseList.map(c => c.state))).slice(0, 3);

        return { advocate, total: caseList.length, fav, dis, fav_pct, totalClaimed, states, caseList };
      });
  }, [cases]);

  const rows = useMemo(() => {
    return [...baseRows].sort((a, b) => {
      if (sortKey === 'advocate') {
        const cmp = a.advocate.localeCompare(b.advocate);
        return sortAsc ? cmp : -cmp;
      }
      const av = (a[sortKey] as number | null) ?? -1;
      const bv = (b[sortKey] as number | null) ?? -1;
      return sortAsc ? av - bv : bv - av;
    });
  }, [baseRows, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc(a => !a); }
    else { setSortKey(key); setSortAsc(false); }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="opacity-20">↕</span>;
    return sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeTh = 'text-foreground';
  const inactiveTh = 'text-muted-foreground hover:text-foreground';

  if (rows.length === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Complainant Counsel</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-xs text-muted-foreground/50">No advocate data available</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground">Complainant Counsel</CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground/60">{rows.length} advocates</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col p-0 pb-2">
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="border-b border-border">
                <th
                  className={`text-left font-semibold py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${sortKey === 'advocate' ? activeTh : inactiveTh}`}
                  onClick={() => toggleSort('advocate')}
                >
                  Advocate <SortIcon col="advocate" />
                </th>
                <th
                  className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${sortKey === 'total' ? activeTh : inactiveTh}`}
                  onClick={() => toggleSort('total')}
                >
                  Cases <SortIcon col="total" />
                </th>
                <th
                  className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-green-600 ${sortKey === 'fav' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                  onClick={() => toggleSort('fav')}
                >
                  Won <SortIcon col="fav" />
                </th>
                <th
                  className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-red-500 ${sortKey === 'dis' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                  onClick={() => toggleSort('dis')}
                >
                  Lost <SortIcon col="dis" />
                </th>
                <th
                  className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${sortKey === 'fav_pct' ? activeTh : inactiveTh}`}
                  onClick={() => toggleSort('fav_pct')}
                >
                  Win% <SortIcon col="fav_pct" />
                </th>
                <th className="text-left font-semibold text-muted-foreground py-2 pl-2 pr-4 text-[10px] uppercase tracking-wider">States</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => (
                <tr
                  key={row.advocate}
                  className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                  onClick={() => openDrawer(`Adv. ${row.advocate} — ${row.total} cases`, row.caseList)}
                >
                  <td className="py-1.5 pl-4 pr-2 font-mono text-foreground text-[10px] max-w-[180px] truncate" title={row.advocate}>
                    {row.advocate}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-right text-muted-foreground">{row.total}</td>
                  <td className="py-1.5 px-2 font-mono text-right text-green-600">{row.fav}</td>
                  <td className="py-1.5 px-2 font-mono text-right text-red-500">{row.dis}</td>
                  <td className="py-1.5 px-2 font-mono text-right">
                    {row.fav_pct != null ? (
                      <span className={row.fav_pct >= 50 ? 'text-green-600 font-semibold' : row.fav_pct >= 25 ? 'text-amber-600' : 'text-muted-foreground'}>
                        {row.fav_pct}%
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 pl-2 pr-4 text-muted-foreground text-[10px]">
                    {row.states.join(', ')}{row.states.length < new Set(row.caseList.map(c => c.state)).size ? '…' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 pt-2 border-t border-border/40 flex-shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
