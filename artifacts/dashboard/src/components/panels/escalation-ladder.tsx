import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';

const RUNG_COLORS = [
  { bar: '#ef4444', glow: 'rgba(239,68,68,0.15)' },   // Execution — red
  { bar: '#f97316', glow: 'rgba(249,115,22,0.15)' },  // Revision — orange
  { bar: '#3b82f6', glow: 'rgba(59,130,246,0.15)' },  // Appeal — blue
  { bar: '#22c55e', glow: 'rgba(34,197,94,0.15)' },   // Complaint — green
  { bar: '#94a3b8', glow: 'rgba(148,163,184,0.1)' },  // Notice — slate
];

export function EscalationLadder({ cases }: { cases: Case[] }) {
  const { lens, openDrawer } = useDashboard();

  const data = useMemo(() => {
    if (!cases) return { rungs: [] };

    const typeCounts = cases.reduce((acc, c) => {
      let type = c.case_type;
      if (type.includes('Execution')) type = 'Execution Application';
      if (type.includes('Revision')) type = 'Revision Petition';
      if (type.includes('First Appeal') || type.includes('Appeal')) type = 'First Appeal';
      if (type.includes('Consumer') || type.includes('CC') || type === 'CC') type = 'Consumer Complaint';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const rungs = [
      { id: 'Execution', label: 'Execution', count: typeCounts['Execution Application'] || 0 },
      { id: 'Revision', label: 'Revision', count: typeCounts['Revision Petition'] || 0 },
      { id: 'Appeal', label: 'First Appeal', count: typeCounts['First Appeal'] || 0 },
      { id: 'Complaint', label: 'Consumer Complaint', count: typeCounts['Consumer Complaint'] || 0 },
      { id: 'Notice', label: 'Notice', count: 0, disabled: true },
    ];

    return { rungs };
  }, [cases]);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Escalation ladder</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  const total = data.rungs.filter(r => !r.disabled).reduce((s, r) => s + r.count, 0);
  const maxCount = Math.max(...data.rungs.map(r => r.count), 1);

  const handleRungClick = (rung: typeof data.rungs[0]) => {
    if (rung.disabled) return;
    const rungCases = cases.filter(c => {
      if (rung.id === 'Execution') return c.case_type.includes('Execution');
      if (rung.id === 'Revision') return c.case_type.includes('Revision');
      if (rung.id === 'Appeal') return c.case_type.includes('Appeal');
      return c.case_type.includes('Consumer') || c.case_type === 'CC';
    });
    openDrawer(`${rung.label} — ${rungCases.length} cases`, rungCases);
  };

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">Escalation ladder</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center gap-4 pb-6 pt-0">
        {data.rungs.map((rung, idx) => {
          const color = RUNG_COLORS[idx];
          const pct = total > 0 && !rung.disabled ? Math.round((rung.count / total) * 100) : 0;
          const barW = rung.disabled ? 8 : Math.max(6, (rung.count / maxCount) * 100);
          return (
            <div
              key={rung.id}
              className={`flex items-center gap-3 ${rung.disabled ? 'opacity-25' : 'cursor-pointer group'}`}
              onClick={() => handleRungClick(rung)}
            >
              <div className="w-32 text-right">
                <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground transition-colors leading-none">
                  {rung.label}
                </span>
              </div>
              <div className="flex-1 relative h-9 flex items-center">
                {/* Track */}
                <div className="absolute inset-0 rounded-md" style={{ background: color.glow }} />
                {/* Fill bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-md transition-all duration-500"
                  style={{
                    width: `${barW}%`,
                    background: rung.disabled
                      ? '#94a3b8'
                      : `linear-gradient(90deg, ${color.bar}cc 0%, ${color.bar} 100%)`,
                    boxShadow: rung.disabled ? 'none' : `0 0 8px ${color.bar}55`,
                  }}
                />
                {/* Count label */}
                <div className="relative z-10 flex items-center justify-between w-full px-3">
                  <span className="font-mono text-sm font-semibold text-white drop-shadow-sm">
                    {rung.disabled ? '—' : rung.count.toLocaleString()}
                  </span>
                  {!rung.disabled && pct > 0 && (
                    <span className="font-mono text-[10px] text-white/70">{pct}%</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
