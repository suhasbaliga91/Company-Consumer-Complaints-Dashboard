import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';

interface Props { cases: Case[] }

const PAGE_SIZE = 20;

interface ComplainantRow {
  advocate: string;
  total: number;
  won: number;
  lost: number;
  win_pct: number | null;
  states: string[];
  caseList: Case[];
}

interface OEMRow {
  advocate: string;
  total: number;
  oemWon: number;
  oemLost: number;
  oem_win_pct: number | null;
  states: string[];
  caseList: Case[];
}

type CompSortKey = 'advocate' | 'total' | 'won' | 'lost' | 'win_pct';
type OEMSortKey = 'advocate' | 'total' | 'oemWon' | 'oemLost' | 'oem_win_pct';

export function CounselPerformance({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [tab, setTab] = useState<'complainant' | 'oem'>('complainant');
  const [page, setPage] = useState(0);

  // Independent sort state for each tab
  const [compSortKey, setCompSortKey] = useState<CompSortKey>('total');
  const [compSortAsc, setCompSortAsc] = useState(false);
  const [oemSortKey, setOEMSortKey] = useState<OEMSortKey>('total');
  const [oemSortAsc, setOEMSortAsc] = useState(false);

  const complainantRows = useMemo((): ComplainantRow[] => {
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
        const won = withOutcome.filter(c => c.outcome && c.outcome.includes('Allowed')).length;
        const lost = withOutcome.filter(c => c.outcome && (c.outcome.includes('Dismiss') || c.outcome.includes('Ex-parte'))).length;
        const win_pct = withOutcome.length > 0 ? Math.round((won / withOutcome.length) * 100) : null;
        const states = Array.from(new Set(caseList.map(c => c.state))).slice(0, 3);
        return { advocate, total: caseList.length, won, lost, win_pct, states, caseList };
      });
  }, [cases]);

  const sortedComplainantRows = useMemo((): ComplainantRow[] => {
    return [...complainantRows].sort((a, b) => {
      if (compSortKey === 'advocate') {
        const cmp = a.advocate.localeCompare(b.advocate);
        return compSortAsc ? cmp : -cmp;
      }
      const av = (a[compSortKey] as number | null) ?? -1;
      const bv = (b[compSortKey] as number | null) ?? -1;
      return compSortAsc ? av - bv : bv - av;
    });
  }, [complainantRows, compSortKey, compSortAsc]);

  const oemRows = useMemo((): OEMRow[] => {
    const advMap: Record<string, Case[]> = {};
    for (const c of cases) {
      const adv = c.resp_advocate?.trim();
      if (!adv) continue;
      if (!advMap[adv]) advMap[adv] = [];
      advMap[adv].push(c);
    }
    return Object.entries(advMap)
      .filter(([, cl]) => cl.length > 1)
      .map(([advocate, caseList]) => {
        const withOutcome = caseList.filter(c => c.outcome);
        // OEM won = case dismissed (complainant lost)
        const oemWon = withOutcome.filter(c => c.outcome && (c.outcome.includes('Dismiss') || c.outcome.includes('Ex-parte'))).length;
        // OEM lost = case allowed (complainant won)
        const oemLost = withOutcome.filter(c => c.outcome && c.outcome.includes('Allowed')).length;
        const oem_win_pct = withOutcome.length > 0 ? Math.round((oemWon / withOutcome.length) * 100) : null;
        const states = Array.from(new Set(caseList.map(c => c.state))).slice(0, 3);
        return { advocate, total: caseList.length, oemWon, oemLost, oem_win_pct, states, caseList };
      });
  }, [cases]);

  const sortedOEMRows = useMemo((): OEMRow[] => {
    return [...oemRows].sort((a, b) => {
      if (oemSortKey === 'advocate') {
        const cmp = a.advocate.localeCompare(b.advocate);
        return oemSortAsc ? cmp : -cmp;
      }
      const av = (a[oemSortKey] as number | null) ?? -1;
      const bv = (b[oemSortKey] as number | null) ?? -1;
      return oemSortAsc ? av - bv : bv - av;
    });
  }, [oemRows, oemSortKey, oemSortAsc]);

  function switchTab(t: 'complainant' | 'oem') {
    setTab(t);
    setPage(0);
  }

  function toggleCompSort(key: CompSortKey) {
    if (compSortKey === key) { setCompSortAsc(a => !a); }
    else { setCompSortKey(key); setCompSortAsc(false); }
    setPage(0);
  }

  function toggleOEMSort(key: OEMSortKey) {
    if (oemSortKey === key) { setOEMSortAsc(a => !a); }
    else { setOEMSortKey(key); setOEMSortAsc(false); }
    setPage(0);
  }

  function CompSortIcon({ col }: { col: CompSortKey }) {
    if (compSortKey !== col) return <span className="opacity-20">↕</span>;
    return compSortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  }

  function OEMSortIcon({ col }: { col: OEMSortKey }) {
    if (oemSortKey !== col) return <span className="opacity-20">↕</span>;
    return oemSortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  }

  const rows = tab === 'complainant' ? sortedComplainantRows : sortedOEMRows;
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeTh = 'text-foreground';
  const inactiveTh = 'text-muted-foreground hover:text-foreground';

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-sm font-semibold text-foreground">Counsel Performance</CardTitle>
          {/* Segmented control */}
          <div className="flex rounded-md border border-border overflow-hidden text-[11px] font-mono">
            <button
              onClick={() => switchTab('complainant')}
              className={`px-3 py-1 transition-colors ${tab === 'complainant' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/30'}`}
            >
              Complainant Advocates
            </button>
            <button
              onClick={() => switchTab('oem')}
              className={`px-3 py-1 border-l border-border transition-colors ${tab === 'oem' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/30'}`}
            >
              Respondent Counsel
            </button>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/60">{rows.length} advocates</span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col p-0 pb-2">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/50">No advocate data available</div>
        ) : (
          <>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                  <tr className="border-b border-border">
                    {tab === 'complainant' ? (
                      <>
                        <th
                          className={`text-left font-semibold py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${compSortKey === 'advocate' ? activeTh : inactiveTh}`}
                          onClick={() => toggleCompSort('advocate')}
                        >
                          Advocate <CompSortIcon col="advocate" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${compSortKey === 'total' ? activeTh : inactiveTh}`}
                          onClick={() => toggleCompSort('total')}
                        >
                          Cases <CompSortIcon col="total" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-green-600 ${compSortKey === 'won' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                          onClick={() => toggleCompSort('won')}
                        >
                          Won <CompSortIcon col="won" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-red-500 ${compSortKey === 'lost' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                          onClick={() => toggleCompSort('lost')}
                        >
                          Lost <CompSortIcon col="lost" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${compSortKey === 'win_pct' ? activeTh : inactiveTh}`}
                          onClick={() => toggleCompSort('win_pct')}
                        >
                          Win% <CompSortIcon col="win_pct" />
                        </th>
                      </>
                    ) : (
                      <>
                        <th
                          className={`text-left font-semibold py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${oemSortKey === 'advocate' ? activeTh : inactiveTh}`}
                          onClick={() => toggleOEMSort('advocate')}
                        >
                          Advocate <OEMSortIcon col="advocate" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${oemSortKey === 'total' ? activeTh : inactiveTh}`}
                          onClick={() => toggleOEMSort('total')}
                        >
                          Cases <OEMSortIcon col="total" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-green-600 ${oemSortKey === 'oemWon' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                          onClick={() => toggleOEMSort('oemWon')}
                        >
                          OEM Won <OEMSortIcon col="oemWon" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none text-red-500 ${oemSortKey === 'oemLost' ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                          onClick={() => toggleOEMSort('oemLost')}
                        >
                          OEM Lost <OEMSortIcon col="oemLost" />
                        </th>
                        <th
                          className={`text-right font-semibold py-2 px-2 text-[10px] uppercase tracking-wider cursor-pointer select-none ${oemSortKey === 'oem_win_pct' ? activeTh : inactiveTh}`}
                          onClick={() => toggleOEMSort('oem_win_pct')}
                        >
                          OEM Win% <OEMSortIcon col="oem_win_pct" />
                        </th>
                      </>
                    )}
                    <th className="text-left font-semibold text-muted-foreground py-2 pl-2 pr-4 text-[10px] uppercase tracking-wider">States</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === 'complainant'
                    ? (pageRows as ComplainantRow[]).map(row => (
                        <tr
                          key={row.advocate}
                          className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                          onClick={() => openDrawer(`Adv. ${row.advocate} — ${row.total} cases`, row.caseList)}
                        >
                          <td className="py-1.5 pl-4 pr-2 font-mono text-foreground text-[10px] max-w-[220px] truncate" title={row.advocate}>
                            {row.advocate}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-right text-muted-foreground">{row.total}</td>
                          <td className="py-1.5 px-2 font-mono text-right text-green-600">{row.won}</td>
                          <td className="py-1.5 px-2 font-mono text-right text-red-500">{row.lost}</td>
                          <td className="py-1.5 px-2 font-mono text-right">
                            {row.win_pct != null ? (
                              <span className={row.win_pct >= 50 ? 'text-green-600 font-semibold' : row.win_pct >= 25 ? 'text-amber-600' : 'text-muted-foreground'}>
                                {row.win_pct}%
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 pl-2 pr-4 text-muted-foreground text-[10px]">
                            {row.states.join(', ')}{new Set(row.caseList.map(c => c.state)).size > 3 ? '…' : ''}
                          </td>
                        </tr>
                      ))
                    : (pageRows as OEMRow[]).map(row => (
                        <tr
                          key={row.advocate}
                          className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                          onClick={() => openDrawer(`Resp. Adv. ${row.advocate} — ${row.total} cases`, row.caseList)}
                        >
                          <td className="py-1.5 pl-4 pr-2 font-mono text-foreground text-[10px] max-w-[220px] truncate" title={row.advocate}>
                            {row.advocate}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-right text-muted-foreground">{row.total}</td>
                          <td className="py-1.5 px-2 font-mono text-right text-green-600">{row.oemWon}</td>
                          <td className="py-1.5 px-2 font-mono text-right text-red-500">{row.oemLost}</td>
                          <td className="py-1.5 px-2 font-mono text-right">
                            {row.oem_win_pct != null ? (
                              <span className={row.oem_win_pct >= 50 ? 'text-green-600 font-semibold' : row.oem_win_pct >= 25 ? 'text-amber-600' : 'text-muted-foreground'}>
                                {row.oem_win_pct}%
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 pl-2 pr-4 text-muted-foreground text-[10px]">
                            {row.states.join(', ')}{new Set(row.caseList.map(c => c.state)).size > 3 ? '…' : ''}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 pt-2 border-t border-border/40 flex-shrink-0">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
