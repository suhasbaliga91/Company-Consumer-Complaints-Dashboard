import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';

interface Props { cases: Case[] }

const STAGES = [
  {
    id: 'Registered / Admission',
    label: 'Admission',
    sub: 'Registered & admitted',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.25)',
  },
  {
    id: 'Hearing / Evidence',
    label: 'Evidence',
    sub: 'Hearing & evidence',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.25)',
  },
  {
    id: 'Arguments',
    label: 'Arguments',
    sub: 'Final arguments',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
  },
  {
    id: 'Order Reserved',
    label: 'Reserved',
    sub: 'Order reserved',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    border: 'rgba(168,85,247,0.25)',
  },
];

export function StageDistribution({ cases }: Props) {
  const { lens, scope, openDrawer } = useDashboard();

  const stages = useMemo(() => {
    if (!cases) return STAGES.map(s => ({ ...s, count: 0 }));
    const counts = cases.reduce((acc, c) => {
      if (c.canonical_stage !== 'Disposed' && c.canonical_stage !== 'Other') {
        acc[c.canonical_stage] = (acc[c.canonical_stage] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    return STAGES.map(s => ({ ...s, count: counts[s.id] || 0 }));
  }, [cases]);

  const total = stages.reduce((s, r) => s + r.count, 0);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Stage distribution</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  if (scope === 'DISPOSED') {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Stage distribution</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
          No active stages for disposed cases
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">Stage distribution</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-2 gap-3 pb-6 pt-0 content-center">
        {stages.map(stage => {
          const pct = total > 0 ? ((stage.count / total) * 100).toFixed(1) : '0.0';
          return (
            <div
              key={stage.id}
              className="flex flex-col gap-2 p-3 rounded-lg cursor-pointer transition-all hover:scale-[1.02]"
              style={{ background: stage.bg, border: `1px solid ${stage.border}` }}
              onClick={() => openDrawer(`${stage.id} — ${stage.count} cases`, cases.filter(c => c.canonical_stage === stage.id))}
            >
              {/* Accent dot + label */}
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{stage.label}</span>
              </div>
              {/* Big count */}
              <div className="font-mono text-2xl font-bold leading-none" style={{ color: stage.color }}>
                {stage.count.toLocaleString()}
              </div>
              {/* Percentage bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: stage.color }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">{pct}%</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
