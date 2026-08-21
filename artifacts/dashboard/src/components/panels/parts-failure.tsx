import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';
import { isFieldApplicable } from '@/lib/field-applicability';

interface Props { cases: Case[] }

const CAT_COLORS: Record<string, string> = {
  'Engine / Transmission':  'hsl(var(--primary))',
  'Electrical / AC':        'hsl(var(--chart-2, 210 100% 60%))',
  'Body / Paint':           'hsl(var(--chart-3, 280 80% 60%))',
  'Suspension / Brakes':    'hsl(var(--chart-4, 340 80% 60%))',
  'Fuel System':            'hsl(var(--chart-5, 40 90% 60%))',
  'Infotainment':           'hsl(var(--chart-1, 160 60% 45%))',
  'Other':                  'hsl(var(--muted-foreground))',
};

/** Normalise a raw part_involved string into one or more canonical component labels. */
function normaliseParts(raw: string): string[] {
  return raw
    .split(/[,;/]|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 80)
    .map((s) => {
      // Skip purely non-latin tokens (e.g. Hindi words)
      if (/^[^\x00-\x7F]+$/.test(s)) return null;
      // Capitalise first letter
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    })
    .filter((s): s is string => s !== null && s.length > 1);
}

export function PartsFailure({ cases }: Props) {
  const { openDrawer } = useDashboard();
  const [view, setView] = useState<'category' | 'component'>('category');
  const applicable = isFieldApplicable(cases, ['part_category', 'part_involved']);

  const { catRows, compRows, isSample } = useMemo(() => {
    // ── Category view ──────────────────────────────────────────────────
    const catCounts: Record<string, Case[]> = {};
    for (const c of cases) {
      if (!c.part_category || c.extraction_status === 'low_confidence') continue;
      if (!catCounts[c.part_category]) catCounts[c.part_category] = [];
      catCounts[c.part_category].push(c);
    }
    const catRows = Object.entries(catCounts)
      .map(([cat, caseList]) => ({ label: cat, count: caseList.length, caseList }))
      .sort((a, b) => b.count - a.count);

    // ── Component view ─────────────────────────────────────────────────
    const compCounts: Record<string, { count: number; cases: Set<string> }> = {};
    // Only include full-status cases (same filter used for counts)
    const compEligible = cases.filter(
      (c) => c.part_involved && c.extraction_status !== 'low_confidence',
    );
    for (const c of compEligible) {
      const parts = normaliseParts(c.part_involved!);
      for (const p of parts) {
        const key = p.toLowerCase();
        if (!compCounts[key]) compCounts[key] = { count: 0, cases: new Set() };
        if (!compCounts[key].cases.has(c.case_number)) {
          compCounts[key].count++;
          compCounts[key].cases.add(c.case_number);
        }
      }
    }
    // Build rows for component view; cap at 15, roll rest into Other
    const sorted = Object.entries(compCounts)
      .map(([key, v]) => ({
        label: key.charAt(0).toUpperCase() + key.slice(1),
        count: v.count,
        // Drill list uses same eligible set so count and drawer are always in sync
        caseList: compEligible.filter(
          (c) => normaliseParts(c.part_involved!).map((s) => s.toLowerCase()).includes(key),
        ),
      }))
      .sort((a, b) => b.count - a.count);
    const top15 = sorted.slice(0, 15);
    const rest  = sorted.slice(15);
    if (rest.length > 0) {
      const otherCases = rest.flatMap((r) => r.caseList);
      top15.push({ label: 'Other', count: rest.reduce((s, r) => s + r.count, 0), caseList: otherCases });
    }
    const compRows = top15;

    const isSample =
      cases.some((c) => c.extraction_status === 'sample') &&
      !cases.some((c) => c.extraction_status === 'full');
    return { catRows, compRows, isSample };
  }, [cases]);

  const rows     = view === 'category' ? catRows : compRows;
  const isEmpty  = catRows.length === 0 && compRows.length === 0;

  if (!applicable) return null;

  if (isEmpty) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">
            Parts-Failure Tracker
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-xs text-muted-foreground/50 font-mono">
          Extraction pending
        </CardContent>
      </Card>
    );
  }

  const max = rows[0]?.count ?? 1;

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">
          Parts-Failure Tracker
        </CardTitle>
        <div className="flex items-center gap-1">
          {isSample && <SampleTag />}
          {/* Toggle */}
          <div className="flex rounded border border-border overflow-hidden text-[10px] font-mono">
            <button
              onClick={() => setView('category')}
              className={`px-2 py-0.5 transition-colors ${
                view === 'category'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/30'
              }`}
            >
              Category
            </button>
            <button
              onClick={() => setView('component')}
              className={`px-2 py-0.5 transition-colors ${
                view === 'component'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/30'
              }`}
            >
              Component
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-[160px] text-xs text-muted-foreground/50 font-mono">
            {view === 'component' ? 'Component data pending — grows as judgments are harvested' : 'No data'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(({ label, count, caseList }) => (
              <button
                key={label}
                onClick={() => openDrawer(`Part: ${label} — ${count} case${count !== 1 ? 's' : ''}`, caseList)}
                className="flex items-center gap-2 group text-left hover:bg-muted/20 rounded px-1 py-0.5 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: CAT_COLORS[label] ?? 'hsl(var(--primary))' }}
                />
                <span className="flex-1 font-mono text-xs truncate text-foreground">{label}</span>
                <div className="w-16 h-1 bg-muted/30 rounded-full">
                  <div
                    className="h-1 rounded-full"
                    style={{
                      width: `${(count / max) * 100}%`,
                      background: CAT_COLORS[label] ?? 'hsl(var(--primary))',
                    }}
                  />
                </div>
                <span className="font-mono text-xs text-primary tabular-nums w-6 text-right">{count}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
