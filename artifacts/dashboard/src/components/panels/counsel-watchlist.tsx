import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Case } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PAGE_SIZE = 10;

export function CounselWatchlist({ cases }: { cases: Case[] }) {
  const { lens, openDrawer } = useDashboard();
  const [page, setPage] = useState(0);

  const data = useMemo(() => {
    if (!cases) return [];

    const counts: Record<string, { count: number; cases: Case[] }> = {};

    cases.forEach(c => {
      if (!c.comp_advocate) return;
      
      const adv = c.comp_advocate.trim().toUpperCase();
      
      // Filter out obvious placeholders
      if (
        !adv || 
        adv.length < 3 ||
        adv === 'IN PERSON' || 
        adv === 'PARTY IN PERSON' || 
        adv === 'NONE' ||
        adv === 'NA' ||
        adv === 'N/A' ||
        adv.includes('INPERSON')
      ) {
        return;
      }

      if (!counts[adv]) counts[adv] = { count: 0, cases: [] };
      counts[adv].count++;
      counts[adv].cases.push(c);
    });

    return Object.entries(counts)
      .map(([name, data]) => ({ name, count: data.count, cases: data.cases }))
      .sort((a, b) => b.count - a.count);
  }, [cases]);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Counsel watchlist</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const pageItems = data.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Complainant counsel</CardTitle>
        <div className="text-xs font-mono text-muted-foreground">{data.length} advocates</div>
      </CardHeader>
      <CardContent className="flex flex-col pt-0 pb-4">
        <div className="space-y-0.5">
          {pageItems.map((item, i) => (
            <div 
              key={item.name + i} 
              className="flex items-center justify-between py-2 px-3 border border-transparent hover:border-border/50 hover:bg-muted/20 rounded-sm cursor-pointer transition-colors group"
              onClick={() => openDrawer(`Counsel: ${item.name}`, item.cases)}
            >
              <div className="font-sans text-xs text-foreground truncate pr-4">{item.name}</div>
              <div className="text-right flex-shrink-0 flex items-center gap-2">
                <div className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors">{item.count}</div>
              </div>
            </div>
          ))}
          {data.length === 0 && (
            <div className="flex items-center justify-center py-6 text-xs font-mono text-muted-foreground text-center px-4">
              Insufficient counsel data
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
