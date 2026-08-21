import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

type SortKey = 'date' | 'state' | 'forum' | 'outcome' | 'claimed' | 'awarded' | 'rec_pct';
type SortDir = 'asc' | 'desc';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

function getOutcomeColor(outcome: string | null | undefined): string {
  if (!outcome) return 'bg-muted text-muted-foreground border-muted-foreground/20';
  const o = outcome.toLowerCase();
  if (o.includes('allow'))   return 'bg-green-50 text-green-700 border-green-200';
  if (o.includes('dismiss') || o.includes('ex-parte')) return 'bg-red-50 text-red-700 border-red-200';
  if (o.includes('settle') || o.includes('withdrawn')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (o.includes('remand'))  return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-muted text-muted-foreground border-muted-foreground/20';
}

const OUTCOME_OPTIONS = ['All', 'Allowed', 'Partially Allowed', 'Dismissed', 'Ex-parte', 'Settled / Withdrawn', 'Remanded', 'Other'];

const JUDGMENT_PAGE_SIZE = 100;

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  className = '',
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className={`font-semibold text-muted-foreground py-2 px-2 text-[10px] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {isActive ? (
          sortDir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-primary" />
            : <ChevronDown className="w-3 h-3 text-primary" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

export function JudgmentBrowser({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [outcomeFilter, setOutcomeFilter] = useState('All');
  const [stateFilter, setStateFilter]     = useState('All');
  const [issueFilter, setIssueFilter]     = useState('All');
  const [search, setSearch]               = useState('');
  const [page, setPage]                   = useState(0);
  const [sortKey, setSortKey]             = useState<SortKey | null>(null);
  const [sortDir, setSortDir]             = useState<SortDir>('asc');

  const { states, issues } = useMemo(() => {
    const states = ['All', ...Array.from(new Set(cases.map(c => c.state))).sort()];
    const issues = ['All', ...Array.from(new Set(cases.map(c => c.issue_type).filter(Boolean) as string[])).sort()];
    return { states, issues };
  }, [cases]);

  const resetPage = () => setPage(0);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        // third click: reset to default order
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cases.filter(c => {
      if (outcomeFilter !== 'All') {
        if (outcomeFilter === 'Other') {
          const known = new Set(['Allowed', 'Partially Allowed', 'Dismissed', 'Ex-parte', 'Settled / Withdrawn', 'Remanded']);
          if (!c.outcome || known.has(c.outcome)) return false;
        } else if (c.outcome !== outcomeFilter) return false;
      }
      if (stateFilter !== 'All' && c.state !== stateFilter) return false;
      if (issueFilter !== 'All' && c.issue_type !== issueFilter) return false;
      if (q) {
        const inCaseNum = c.case_number.toLowerCase().includes(q);
        const inSnippet = c.source_snippet?.toLowerCase().includes(q);
        if (!inCaseNum && !inSnippet) return false;
      }
      return true;
    });
  }, [cases, outcomeFilter, stateFilter, issueFilter, search]);

  const sorted = useMemo(() => {
    if (!sortKey) {
      // Default: newest disposal/filing date first, nulls last
      return [...filtered].sort((a, b) => {
        const aDate = a.disposal_date ?? a.filing_date ?? null;
        const bDate = b.disposal_date ?? b.filing_date ?? null;
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate);
      });
    }

    const dir = sortDir === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case 'date': {
          aVal = a.disposal_date ?? a.filing_date ?? null;
          bVal = b.disposal_date ?? b.filing_date ?? null;
          break;
        }
        case 'state': {
          aVal = a.state ?? null;
          bVal = b.state ?? null;
          break;
        }
        case 'forum': {
          aVal = a.commission ?? null;
          bVal = b.commission ?? null;
          break;
        }
        case 'outcome': {
          aVal = a.outcome ?? null;
          bVal = b.outcome ?? null;
          break;
        }
        case 'claimed': {
          aVal = a.claim_amount ?? null;
          bVal = b.claim_amount ?? null;
          break;
        }
        case 'awarded': {
          aVal = a.amount_awarded ?? null;
          bVal = b.amount_awarded ?? null;
          break;
        }
        case 'rec_pct': {
          aVal = (a.claim_amount && a.amount_awarded) ? a.amount_awarded / a.claim_amount : null;
          bVal = (b.claim_amount && b.amount_awarded) ? b.amount_awarded / b.claim_amount : null;
          break;
        }
      }

      // Nulls always last regardless of direction
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages  = Math.ceil(sorted.length / JUDGMENT_PAGE_SIZE);
  const pageRows    = sorted.slice(page * JUDGMENT_PAGE_SIZE, (page + 1) * JUDGMENT_PAGE_SIZE);

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Judgment Browser
            <span className="ml-2 font-mono text-xs text-muted-foreground/60 font-normal">
              {filtered.length} of {cases.length} cases
            </span>
          </CardTitle>
          <button
            className="text-[10px] font-mono text-primary hover:underline"
            onClick={() => openDrawer('All Disposed Cases', filtered)}
          >
            Open in drawer →
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap pt-2">
          <Input
            className="h-8 text-xs w-48 border-border bg-white"
            placeholder="Search case no. or snippet…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage(); }}
          />
          <Select value={outcomeFilter} onValueChange={v => { setOutcomeFilter(v); resetPage(); }}>
            <SelectTrigger className="h-8 text-xs w-40 border-border bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OUTCOME_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={v => { setStateFilter(v); resetPage(); }}>
            <SelectTrigger className="h-8 text-xs w-36 border-border bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {states.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={issueFilter} onValueChange={v => { setIssueFilter(v); resetPage(); }}>
            <SelectTrigger className="h-8 text-xs w-44 border-border bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {issues.map(i => <SelectItem key={i} value={i} className="text-xs">{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0 pb-0 flex flex-col">
        <div className="overflow-auto" style={{ maxHeight: 420 }}>
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="border-b border-border">
                <th className="text-left font-semibold text-muted-foreground py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider whitespace-nowrap">Case No.</th>
                <SortableHeader label="State"   sortKey="state"   activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Forum"   sortKey="forum"   activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Date"    sortKey="date"    activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Outcome" sortKey="outcome" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Claimed" sortKey="claimed" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader label="Awarded" sortKey="awarded" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader label="Rec%"    sortKey="rec_pct" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <th className="text-left font-semibold text-muted-foreground py-2 px-2 text-[10px] uppercase tracking-wider">Top Ground</th>
                <th className="text-left font-semibold text-muted-foreground py-2 px-2 pr-4 text-[10px] uppercase tracking-wider">Snippet</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-muted-foreground text-xs">No cases match current filters</td>
                </tr>
              ) : (
                pageRows.map(c => {
                  const recPct = c.claim_amount && c.amount_awarded
                    ? Math.round((c.amount_awarded / c.claim_amount) * 100)
                    : null;
                  const topGround = c.grounds_taken?.[0];
                  const displayDate = c.disposal_date ?? c.filing_date ?? null;
                  const benchLine = c.bench && c.bench.length > 0
                    ? c.bench.join(', ')
                    : null;

                  return (
                    <tr
                      key={c.case_number}
                      className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                      onClick={() => openDrawer(c.case_number, [c])}
                    >
                      <td className="py-1.5 pl-4 pr-2 font-mono text-foreground whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span>{c.case_number}</span>
                          {benchLine && (
                            <span className="text-[9px] text-muted-foreground/60 font-sans truncate max-w-[160px]" title={benchLine}>
                              {benchLine}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{c.state}</td>
                      <td className="py-1.5 px-2 text-muted-foreground max-w-[120px] truncate" title={c.commission}>{c.commission}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <span className="font-mono text-[10px] text-muted-foreground">{displayDate ?? '—'}</span>
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5 items-start">
                          {c.outcome ? (
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 rounded-md border ${getOutcomeColor(c.outcome)}`}>{c.outcome}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 rounded-md border bg-muted/40 text-muted-foreground border-muted-foreground/20">Pending extraction</Badge>
                          )}
                          {c.has_judgment && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 rounded-md border bg-blue-50 text-blue-600 border-blue-200">Judgment</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-right text-muted-foreground whitespace-nowrap">{fmt(c.claim_amount)}</td>
                      <td className="py-1.5 px-2 font-mono text-right text-foreground whitespace-nowrap">{fmt(c.amount_awarded)}</td>
                      <td className="py-1.5 px-2 font-mono text-right whitespace-nowrap">
                        {recPct != null ? <span className={recPct >= 50 ? 'text-green-600' : 'text-red-500'}>{recPct}%</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground max-w-[140px] truncate text-[10px]" title={topGround}>{topGround ?? '—'}</td>
                      <td className="py-1.5 px-2 pr-4 text-muted-foreground/70 max-w-[200px] truncate text-[10px]" title={c.source_snippet ?? undefined}>
                        {c.source_snippet ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/40 flex-shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground">
              Showing {page * JUDGMENT_PAGE_SIZE + 1}–{Math.min((page + 1) * JUDGMENT_PAGE_SIZE, sorted.length)} of {sorted.length}
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
