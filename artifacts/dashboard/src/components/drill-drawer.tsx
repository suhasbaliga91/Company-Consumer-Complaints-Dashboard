import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { X, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDashboard } from './dashboard-context';
import { Case } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatINR(amount: number | null | undefined): string | null {
  if (amount == null) return null;
  return '₹' + amount.toLocaleString('en-IN');
}

function getStageColor(stage: string) {
  switch (stage) {
    case 'Disposed': return 'bg-muted text-muted-foreground border-muted-foreground/20';
    case 'Registered / Admission': return 'bg-primary/10 text-primary border-primary/20';
    case 'Hearing / Evidence': return 'bg-chart-3/10 text-chart-3 border-chart-3/20';
    case 'Arguments': return 'bg-chart-4/10 text-chart-4 border-chart-4/20';
    case 'Order Reserved': return 'bg-chart-2/10 text-chart-2 border-chart-2/20';
    default: return 'bg-secondary text-secondary-foreground border-border';
  }
}

// OEM's perspective: Dismissed = good (green), Allowed = bad (red)
function getOutcomeColor(outcome: string | null | undefined) {
  if (!outcome) return 'bg-muted text-muted-foreground border-muted-foreground/20';
  const o = outcome.toLowerCase();
  if (o.includes('dismiss') || o.includes('ex-parte')) return 'bg-green-50 text-green-700 border-green-200';
  if (o.includes('allow')) return 'bg-red-50 text-red-700 border-red-200';
  if (o.includes('settle') || o.includes('partial')) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-muted text-muted-foreground border-muted-foreground/20';
}

// ---------------------------------------------------------------------------
// Sort types and helper
// ---------------------------------------------------------------------------

type SortKey = 'case_number' | 'commission' | 'state' | 'complainant' | 'respondent' | 'outcome' | 'stage' | 'date' | 'next_hearing';
type SortDir = 'asc' | 'desc';

const DEFAULT_SORT_KEY: SortKey = 'date';
const DEFAULT_SORT_DIR: SortDir = 'desc';

function getSortValue(c: Case, key: SortKey): string | null {
  switch (key) {
    case 'case_number':  return c.case_number ?? null;
    case 'commission':   return c.commission ?? null;
    case 'state':        return c.state ?? null;
    case 'complainant':  return c.complainant ?? null;
    case 'respondent':   return c.respondent ?? null;
    case 'outcome':      return c.outcome ?? null;
    case 'stage':        return c.canonical_stage ?? null;
    case 'date':         return (c as any).disposal_date ?? c.filing_date ?? null;
    case 'next_hearing': return c.next_hearing ?? null;
  }
}

// ---------------------------------------------------------------------------
// Sortable header component
// ---------------------------------------------------------------------------

function SortableTableHead({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  className = '',
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <TableHead
      className={`text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
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
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Expanded row detail panel
// ---------------------------------------------------------------------------

function DetailPanel({ c }: { c: Case }) {
  const dealership = c.dealership_canonical || c.dealership_extracted;
  const hasParties = c.complainant || c.respondent || c.comp_advocate || c.resp_advocate;
  const hasFinancials = c.claim_amount != null || c.amount_awarded != null;
  const hasIssue = c.issue_type || c.sales_or_service || c.warranty_related != null ||
    c.product_model || c.is_ev != null || c.part_involved || c.part_category;
  const hasDealership = !!dealership;
  const hasGrounds = c.grounds_taken && c.grounds_taken.length > 0;
  const hasSnippet = !!c.source_snippet;

  return (
    <div className="bg-muted/30 border-t border-border px-4 py-4 space-y-4">
      {/* Parties & Advocates */}
      {hasParties && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Parties</h4>
          <div className="grid grid-cols-2 gap-3">
            {(c.complainant || c.comp_advocate) && (
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Complainant</p>
                {c.complainant && <p className="text-xs font-medium text-foreground">{c.complainant}</p>}
                {c.comp_advocate && <p className="text-[11px] text-muted-foreground italic">Adv. {c.comp_advocate}</p>}
              </div>
            )}
            {(c.respondent || c.resp_advocate) && (
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Respondent</p>
                {c.respondent && <p className="text-xs font-medium text-foreground">{c.respondent}</p>}
                {c.resp_advocate && <p className="text-[11px] text-muted-foreground italic">Adv. {c.resp_advocate}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Financials */}
      {hasFinancials && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Financials</h4>
          <div className="flex gap-6">
            {c.claim_amount != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Claim Amount</p>
                <p className="text-sm font-semibold text-foreground">{formatINR(c.claim_amount)}</p>
              </div>
            )}
            {c.amount_awarded != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount Awarded</p>
                <p className="text-sm font-semibold text-red-700">{formatINR(c.amount_awarded)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Issue & Product */}
      {hasIssue && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Issue & Product</h4>
          <div className="flex flex-wrap gap-2">
            {c.issue_type && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-white border-border text-foreground">
                {c.issue_type}
              </Badge>
            )}
            {c.sales_or_service && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 border-blue-200 text-blue-700">
                {c.sales_or_service}
              </Badge>
            )}
            {c.warranty_related && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 border-purple-200 text-purple-700">
                Warranty
              </Badge>
            )}
            {c.is_ev && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-50 border-green-200 text-green-700">
                EV
              </Badge>
            )}
            {c.product_model && (
              <span className="text-xs text-muted-foreground">Model: <span className="text-foreground font-medium">{c.product_model}</span></span>
            )}
            {c.part_involved && (
              <span className="text-xs text-muted-foreground">Part: <span className="text-foreground font-medium">{c.part_involved}</span></span>
            )}
            {c.part_category && !c.part_involved && (
              <span className="text-xs text-muted-foreground">Category: <span className="text-foreground font-medium">{c.part_category}</span></span>
            )}
          </div>
        </div>
      )}

      {/* Dealership */}
      {hasDealership && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Dealership</h4>
          <p className="text-xs text-foreground">{dealership}</p>
        </div>
      )}

      {/* Legal Grounds */}
      {hasGrounds && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Legal Grounds</h4>
          <ul className="space-y-1">
            {c.grounds_taken!.map((g, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-1 w-1 h-1 rounded-full bg-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground">{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Judgment Excerpt */}
      {hasSnippet && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Judgment / Order</h4>
          <div className="max-h-40 overflow-y-auto rounded border border-border bg-white p-3">
            <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap font-mono">{c.source_snippet}</p>
          </div>
        </div>
      )}

      {/* Confidence */}
      {c.confidence != null && (
        <p className="text-[10px] text-muted-foreground">
          Extraction confidence: {Math.round(c.confidence * 100)}%
          {c.confidence < 0.35 && <span className="ml-1 text-amber-600 font-medium">(low — treat with caution)</span>}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable table row
// ---------------------------------------------------------------------------

function CaseTableRow({ c }: { c: Case }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Chevron */}
        <TableCell className="w-6 pr-0 pl-3">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        </TableCell>

        <TableCell className="font-mono text-xs font-medium text-foreground whitespace-nowrap">{c.case_number}</TableCell>
        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={c.commission}>{c.commission}</TableCell>
        <TableCell className="text-xs text-foreground whitespace-nowrap">{c.state === 'INDIA' ? 'NCDRC' : c.state}</TableCell>

        {/* Complainant */}
        <TableCell className="text-xs text-foreground max-w-[140px]">
          {c.complainant
            ? <span className="truncate block" title={c.complainant}>{c.complainant}</span>
            : <span className="text-muted-foreground">—</span>}
        </TableCell>

        {/* Respondent */}
        <TableCell className="text-xs text-foreground max-w-[140px]">
          {c.respondent
            ? <span className="truncate block" title={c.respondent}>{c.respondent}</span>
            : <span className="text-muted-foreground">—</span>}
        </TableCell>

        {/* Outcome */}
        <TableCell className="whitespace-nowrap">
          {c.outcome
            ? <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-md border ${getOutcomeColor(c.outcome)}`}>{c.outcome}</Badge>
            : <span className="text-muted-foreground text-xs">—</span>}
        </TableCell>

        <TableCell className="whitespace-nowrap">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-md border ${getStageColor(c.canonical_stage)}`}>
            {c.canonical_stage}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {c.filing_date ? format(new Date(c.filing_date), 'dd MMM yyyy') : '—'}
        </TableCell>
        <TableCell className="font-mono text-xs text-foreground whitespace-nowrap">
          {c.next_hearing ? format(new Date(c.next_hearing), 'dd MMM yyyy') : '—'}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="border-b border-border/50">
          <TableCell colSpan={10} className="p-0">
            <DetailPanel c={c} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

const PAGE_SIZE = 200;

export function DrillDrawer() {
  const { drawer, closeDrawer } = useDashboard();
  const { isOpen, title, cases } = drawer;

  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);

  // Reset to first page and default sort whenever the case list changes (new drawer open)
  useEffect(() => {
    setPage(0);
    setSortKey(DEFAULT_SORT_KEY);
    setSortDir(DEFAULT_SORT_DIR);
  }, [cases]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  }

  // Sort cases before pagination
  const sortedCases = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...cases].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      // Nulls always last regardless of direction
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return aVal.localeCompare(bVal) * dir;
    });
  }, [cases, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedCases.length / PAGE_SIZE));
  const startIdx = page * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, sortedCases.length);
  const displayCases = sortedCases.slice(startIdx, endIdx);

  const badgeLabel = cases.length === 0
    ? '0 matches'
    : totalPages === 1
      ? `${cases.length} matches`
      : `${startIdx + 1}–${endIdx} of ${cases.length} matches`;

  const PageControls = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center gap-1 ${compact ? '' : ''}`}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={page === 0}
        onClick={() => setPage((p) => p - 1)}
      >
        ← Prev
      </Button>
      <span className="text-xs text-muted-foreground px-1">
        {page + 1} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={page >= totalPages - 1}
        onClick={() => setPage((p) => p + 1)}
      >
        Next →
      </Button>
    </div>
  );

  return (
    <Drawer open={isOpen} onOpenChange={(o) => !o && closeDrawer()}>
      <DrawerContent className="h-[85vh] bg-white border-l border-border">
        <DrawerHeader className="border-b border-border flex items-center justify-between bg-white">
          <div className="flex items-center gap-3 flex-wrap">
            <DrawerTitle className="text-lg font-semibold text-foreground flex items-center gap-3">
              {title}
              <Badge variant="outline" className="font-normal text-xs bg-muted border-border text-muted-foreground">
                {badgeLabel}
              </Badge>
            </DrawerTitle>
            {totalPages > 1 && <PageControls />}
          </div>
          <div className="flex items-center gap-2">
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="overflow-auto p-4 bg-background">
          <div className="border border-border rounded-lg overflow-hidden bg-white shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="w-6 pr-0 pl-3" />
                  <SortableTableHead label="Case No."     sortKey="case_number"  activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Forum"        sortKey="commission"   activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="State"        sortKey="state"        activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Complainant"  sortKey="complainant"  activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Respondent"   sortKey="respondent"   activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Outcome"      sortKey="outcome"      activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Stage"        sortKey="stage"        activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Filing Date"  sortKey="date"         activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableTableHead label="Next Hearing" sortKey="next_hearing" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayCases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center h-24 text-muted-foreground text-sm">
                      No cases to display.
                    </TableCell>
                  </TableRow>
                ) : (
                  displayCases.map((c) => (
                    <CaseTableRow key={c.case_number} c={c} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center pt-4">
              <PageControls compact />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
