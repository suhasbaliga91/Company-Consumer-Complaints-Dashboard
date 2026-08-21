import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Case } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SampleTag } from './sample-tag';

const PAGE_SIZE = 10;

// Garbage phrases that should never appear in a dealership name
const DEALER_GARBAGE = /represented by|authorised dealer|authorized dealer|its dealer|service cent(?:re|er)|&\s*anr\.?|&\s*ors\.?|\bors\.?\b|\banr\.?\b/i;
const EDGE_CONJUNCTION = /^(and|or|of|the|its|by|&)\b|\b(and|or|of|the|its|by|&)$/i;

// Heuristic fallback: extract dealer from respondent string when LLM fields are absent
function extractDealerHeuristic(respondent: string): string {
  let dealer = '';
  if (respondent.includes(',')) {
    const parts = respondent.split(',');
    if (parts.length > 1) dealer = parts[1].trim();
  } else if (/& ANR/i.test(respondent)) {
    dealer = respondent.replace(/& ANR\.?/gi, '').trim();
  }
  dealer = dealer.replace(/\b(LTD|LTD\.|LIMITED|PVT|PRIVATE)\b/gi, '').replace(/[.,]/g, '').trim();
  if (
    dealer.length >= 5 &&
    !DEALER_GARBAGE.test(dealer) &&
    !EDGE_CONJUNCTION.test(dealer)
  ) return dealer;
  return '';
}

export function DealershipWatchlist({ cases }: { cases: Case[] }) {
  const { lens, openDrawer } = useDashboard();
  const [page, setPage] = useState(0);

  const { data, source, isSample } = useMemo(() => {
    if (!cases) return { data: [], source: 'heuristic' as const, isSample: false };

    const counts: Record<string, { count: number; cases: Case[] }> = {};
    let llmCount = 0;
    let canonicalCount = 0;

    cases.forEach(c => {
      // Priority: LLM from judgment text → LLM from respondent → heuristic
      let dealer: string | null = null;

      if (c.dealership_extracted) {
        dealer = c.dealership_extracted;
        llmCount++;
      } else if (c.dealership_canonical) {
        dealer = c.dealership_canonical;
        canonicalCount++;
      } else if (c.respondent) {
        dealer = extractDealerHeuristic(c.respondent) || null;
      }

      if (!dealer) return;

      if (!counts[dealer]) counts[dealer] = { count: 0, cases: [] };
      counts[dealer].count++;
      counts[dealer].cases.push(c);
    });

    const data = Object.entries(counts)
      .map(([name, d]) => ({ name, count: d.count, cases: d.cases }))
      .sort((a, b) => b.count - a.count);

    const source = (llmCount + canonicalCount) > 0
      ? (llmCount > canonicalCount ? 'judgment-llm' : 'respondent-llm')
      : 'heuristic';

    const isSample = cases.some(c => c.extraction_status === 'sample') &&
                     !cases.some(c => c.extraction_status === 'full');

    return { data, source, isSample };
  }, [cases]);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Partners Watch</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  const sourceLabel = source === 'judgment-llm'
    ? 'LLM · Judgment'
    : source === 'respondent-llm'
    ? 'LLM · Respondent'
    : 'Heuristic';

  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const pageItems = data.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Partners Watch</CardTitle>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground/50">{sourceLabel}</span>
          {isSample && <SampleTag />}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col pt-0 pb-4">
        <div className="space-y-0.5">
          {pageItems.map((item, i) => (
            <div
              key={item.name + i}
              className="flex items-center justify-between py-2 px-3 border border-transparent hover:border-border/50 hover:bg-muted/20 rounded-sm cursor-pointer transition-colors group"
              onClick={() => openDrawer(`Partner: ${item.name}`, item.cases)}
            >
              <div className="font-sans text-xs text-foreground truncate pr-4">{item.name}</div>
              <div className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0">{item.count}</div>
            </div>
          ))}
          {data.length === 0 && (
            <div className="flex items-center justify-center py-6 text-xs font-mono text-muted-foreground text-center px-4">
              No partner data — run extract_respondents.py to populate
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1"
            >
              ← Prev
            </button>
            <span className="text-[10px] font-mono text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.length)} of {data.length}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1"
            >
              Next →
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
