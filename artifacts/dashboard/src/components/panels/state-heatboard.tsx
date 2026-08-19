import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';

// OEM's perspective: Dismissed/Ex-parte = OEM wins
const FAVOURABLE_OUTCOMES = new Set(['Dismissed', 'Ex-parte']);
const KNOWN_OUTCOMES = new Set(['Allowed', 'Dismissed', 'Partially Allowed', 'Remanded', 'Settled / Withdrawn', 'Ex-parte', 'Other']);

interface StateHeatboardProps {
  cases: Case[];
  colorBy?: 'count' | 'winRate';
}

export function StateHeatboard({ cases, colorBy = 'count' }: StateHeatboardProps) {
  const { lens, openDrawer } = useDashboard();

  const data = useMemo(() => {
    if (!cases) return [];

    if (colorBy === 'winRate') {
      const stateMap: Record<string, { total: number; known: number; fav: number; cases: Case[] }> = {};
      for (const c of cases) {
        const state = c.state === 'INDIA' ? 'NCDRC' : c.state;
        if (!stateMap[state]) stateMap[state] = { total: 0, known: 0, fav: 0, cases: [] };
        stateMap[state].total++;
        stateMap[state].cases.push(c);
        if (c.outcome && KNOWN_OUTCOMES.has(c.outcome)) {
          stateMap[state].known++;
          if (FAVOURABLE_OUTCOMES.has(c.outcome)) stateMap[state].fav++;
        }
      }
      return Object.entries(stateMap)
        .map(([name, d]) => ({
          name,
          count: d.total,
          winRate: d.known > 0 ? Math.round((d.fav / d.known) * 100) : null,
          known: d.known,
          stateCases: d.cases,
        }))
        .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
    }

    const counts = cases.reduce((acc, c) => {
      const state = c.state === 'INDIA' ? 'NCDRC' : c.state;
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, winRate: null as number | null, known: 0, stateCases: cases.filter(c => (c.state === 'INDIA' ? 'NCDRC' : c.state) === name) }))
      .sort((a, b) => b.count - a.count);
  }, [cases, colorBy]);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="h-full bg-card border-border flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">State heatboard</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  const maxCount = data[0]?.count || 1;
  const subtitle = colorBy === 'winRate' ? 'by win rate' : `${data.length} states`;

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex flex-row items-center justify-between flex-shrink-0">
        <CardTitle className="text-sm font-semibold text-foreground">State heatboard</CardTitle>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-3 pt-0 overflow-y-auto">
        <div className="flex flex-col gap-1">
          {data.map((entry, idx) => {
            // For winRate mode: colour by win % (green spectrum); for count mode: blue spectrum
            let ratio: number;
            let barColor: string;
            let valueLabel: string;

            if (colorBy === 'winRate') {
              const wr = entry.winRate;
              ratio = wr != null ? wr / 100 : 0;
              const opacity = wr != null ? 0.2 + ratio * 0.8 : 0.1;
              const isNcdrc = entry.name === 'NCDRC';
              barColor = wr == null
                ? `rgba(160,160,160,0.15)`
                : isNcdrc
                  ? `rgba(245,158,11,${opacity})`
                  : `rgba(34,197,94,${opacity})`;   // green for win-rate
              valueLabel = wr != null ? `${wr}% (${entry.count})` : `— (${entry.count})`;
            } else {
              ratio = entry.count / maxCount;
              const opacity = 0.15 + ratio * 0.85;
              const isNcdrc = entry.name === 'NCDRC';
              barColor = isNcdrc
                ? `rgba(245,158,11,${opacity})`
                : `rgba(59,130,246,${opacity})`;
              valueLabel = entry.count.toLocaleString();
            }

            const rank = idx + 1;

            return (
              <div
                key={entry.name}
                className="flex items-center gap-2 group cursor-pointer"
                onClick={() => openDrawer(`${entry.name} — ${entry.count} cases`, entry.stateCases)}
              >
                {/* Rank */}
                <span className="font-mono text-[9px] text-muted-foreground/40 w-4 text-right flex-shrink-0">
                  {rank}
                </span>
                {/* Bar row */}
                <div className="flex-1 relative h-6 rounded-sm overflow-hidden flex items-center">
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded-sm transition-all"
                    style={{ width: `${Math.max(4, ratio * 100)}%`, background: barColor }}
                  />
                  <div className="relative z-10 flex items-center justify-between w-full px-2">
                    <span
                      className="font-mono text-[10px] truncate"
                      style={{ color: ratio > 0.5 ? '#fff' : 'hsl(var(--foreground))' }}
                    >
                      {entry.name}
                    </span>
                    <span
                      className="font-mono text-[10px] font-semibold ml-2 min-w-0 shrink-0"
                      style={{ color: ratio > 0.85 ? 'rgba(255,255,255,0.85)' : 'hsl(var(--muted-foreground))' }}
                    >
                      {valueLabel}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
