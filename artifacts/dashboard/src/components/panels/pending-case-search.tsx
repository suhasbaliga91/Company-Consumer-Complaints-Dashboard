import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Case } from '@workspace/api-client-react';
import { format } from 'date-fns';

interface Props { cases: Case[] }

type SortKey = 'state' | 'forum' | 'stage' | 'filing_date' | 'next_hearing';
type SortDir = 'asc' | 'desc';

function getStageColor(stage: string): string {
  switch (stage) {
    case 'Disposed':                return 'bg-muted text-muted-foreground border-muted-foreground/20';
    case 'Registered / Admission':  return 'bg-primary/10 text-primary border-primary/20';
    case 'Hearing / Evidence':      return 'bg-chart-3/10 text-chart-3 border-chart-3/20';
    case 'Arguments':               return 'bg-chart-4/10 text-chart-4 border-chart-4/20';
    case 'Order Reserved':          return 'bg-chart-2/10 text-chart-2 border-chart-2/20';
    default:                        return 'bg-secondary text-secondary-foreground border-border';
  }
}

const PAGE_SIZE = 100;

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  className = '',
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className={`text-left font-semibold text-muted-foreground py-2 px-2 text-[10px] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
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

export function PendingCaseSearch({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [search, setSearch]           = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [forumFilter, setForumFilter] = useState('All');
  const [page, setPage]               = useState(0);
  const [sortKey, setSortKey]         = useState<SortKey | null>(null);
  const [sortDir, setSortDir]         = useState<SortDir>('asc');

  const { states, stages, forums } = useMemo(() => {
    const states = ['All', ...Array.from(new Set(cases.map(c => c.state))).sort()];
    const stages = ['All', ...Array.from(new Set(cases.map(c => c.canonical_stage).filter(Boolean))).sort()];
    const stateCases = stateFilter === 'All' ? cases : cases.filter(c => c.state === stateFilter);
    const forums = ['All', ...Array.from(new Set(stateCases.map(c => c.commission).filter(Boolean))).sort()];
    return { states, stages, forums };
  }, [cases, stateFilter]);

  const resetPage = () => setPage(0);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        // Third click: reset to default (next-hearing-first)
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
      if (stateFilter !== 'All' && c.state !== stateFilter) return false;
      if (stageFilter !== 'All' && c.canonical_stage !== stageFilter) return false;
      if (forumFilter !== 'All' && c.commission !== forumFilter) return false;
      if (q) {
        const inCaseNum    = c.case_number.toLowerCase().includes(q);
        const inRespondent = c.respondent?.toLowerCase().includes(q) ?? false;
        if (!inCaseNum && !inRespondent) return false;
      }
      return true;
    });
  }, [cases, stateFilter, stageFilter, forumFilter, search]);

  const sorted = useMemo(() => {
    if (!sortKey) {
      // Default: newest filing date first, nulls last
      return [...filtered].sort((a, b) => {
        if (!a.filing_date && !b.filing_date) return 0;
        if (!a.filing_date) return 1;
        if (!b.filing_date) return -1;
        return b.filing_date.localeCompare(a.filing_date);
      });
    }

    const dir = sortDir === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      let aVal: string | null = null;
      let bVal: string | null = null;

      switch (sortKey) {
        case 'state':        { aVal = a.state ?? null;           bVal = b.state ?? null;           break; }
        case 'forum':        { aVal = a.commission ?? null;      bVal = b.commission ?? null;      break; }
        case 'stage':        { aVal = a.canonical_stage ?? null; bVal = b.canonical_stage ?? null; break; }
        case 'filing_date':  { aVal = a.filing_date ?? null;     bVal = b.filing_date ?? null;     break; }
        case 'next_hearing': { aVal = a.next_hearing ?? null;    bVal = b.next_hearing ?? null;    break; }
      }

      // Nulls always last regardless of direction
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      return aVal.localeCompare(bVal) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Case Search
            <span className="ml-2 font-mono text-xs text-muted-foreground/60 font-normal">
              {filtered.length} of {cases.length} cases
            </span>
          </CardTitle>
          <button
            className="text-[10px] font-mono text-primary hover:underline"
            onClick={() => openDrawer('Pending Cases', filtered)}
          >
            Open in drawer →
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap pt-2">
          <Input
            className="h-8 text-xs w-52 border-border bg-white"
            placeholder="Search case no. or respondent…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage(); }}
          />
          <Select value={stateFilter} onValueChange={v => {
            setStateFilter(v);
            // Reset forum if it won't exist in the new state's forums
            if (forumFilter !== 'All') {
              const newStateCases = v === 'All' ? cases : cases.filter(c => c.state === v);
              const newForums = new Set(newStateCases.map(c => c.commission).filter(Boolean));
              if (!newForums.has(forumFilter)) setForumFilter('All');
            }
            resetPage();
          }}>
            <SelectTrigger className="h-8 text-xs w-36 border-border bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {states.map(s => <SelectItem key={s} value={s} className="text-xs">{s === 'INDIA' ? 'NCDRC' : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stageFilter} onValueChange={v => { setStageFilter(v); resetPage(); }}>
            <SelectTrigger className="h-8 text-xs w-44 border-border bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {stages.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={forumFilter} onValueChange={v => { setForumFilter(v); resetPage(); }}>
            <SelectTrigger className="h-8 text-xs w-56 border-border bg-white"><SelectValue placeholder="All Forums" /></SelectTrigger>
            <SelectContent>
              {forums.map(f => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0 pb-0 flex flex-col">
        <div className="overflow-auto" style={{ maxHeight: 520 }}>
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="border-b border-border">
                <th className="text-left font-semibold text-muted-foreground py-2 pl-4 pr-2 text-[10px] uppercase tracking-wider whitespace-nowrap">Case No.</th>
                <SortableHeader label="State"        sortKey="state"        activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Forum"        sortKey="forum"        activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Stage"        sortKey="stage"        activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Filing Date"  sortKey="filing_date"  activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Next Hearing" sortKey="next_hearing" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <th className="text-left font-semibold text-muted-foreground py-2 px-2 pr-4 text-[10px] uppercase tracking-wider">Respondent</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground text-xs">No cases match current filters</td>
                </tr>
              ) : (
                pageRows.map(c => (
                  <tr
                    key={c.case_number}
                    className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                    onClick={() => openDrawer(c.case_number, [c])}
                  >
                    <td className="py-1.5 pl-4 pr-2 font-mono text-foreground whitespace-nowrap">{c.case_number}</td>
                    <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{c.state === 'INDIA' ? 'NCDRC' : c.state}</td>
                    <td className="py-1.5 px-2 text-muted-foreground max-w-[140px] truncate" title={c.commission}>{c.commission}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 rounded-md border ${getStageColor(c.canonical_stage)}`}>
                        {c.canonical_stage}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-muted-foreground whitespace-nowrap">
                      {c.filing_date ? format(new Date(c.filing_date), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-foreground whitespace-nowrap">
                      {c.next_hearing ? format(new Date(c.next_hearing), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="py-1.5 px-2 pr-4 text-muted-foreground max-w-[180px] truncate text-[10px]" title={c.respondent ?? undefined}>
                      {c.respondent ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/40 flex-shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
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
