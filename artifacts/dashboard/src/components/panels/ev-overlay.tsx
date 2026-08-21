import { useMemo } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';
import { Zap } from 'lucide-react';
import { isFieldApplicable } from '@/lib/field-applicability';

interface Props { cases: Case[] }

export function EvOverlay({ cases }: Props) {
  const { openDrawer } = useDashboard();

  const applicable = isFieldApplicable(cases, ['is_ev']);

  const { evCases, nonEvCases, evPct, hasData, isSample } = useMemo(() => {
    const extracted = cases.filter((c) => c.is_ev !== null && c.extraction_status !== 'low_confidence');
    if (extracted.length === 0) return { evCases: [], nonEvCases: [], evPct: 0, hasData: false, isSample: false };
    const evCases = extracted.filter((c) => c.is_ev === true);
    const nonEvCases = extracted.filter((c) => c.is_ev === false);
    const evPct = extracted.length > 0 ? Math.round((evCases.length / extracted.length) * 100) : 0;
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    return { evCases, nonEvCases, evPct, hasData: true, isSample };
  }, [cases]);

  if (!applicable) return null;

  if (!hasData) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">EV Overlay</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[100px] text-xs text-muted-foreground/50 font-mono">Extraction pending</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border cursor-pointer hover:bg-muted/10 transition-colors"
      onClick={() => evCases.length > 0 && openDrawer(`EV Cases — ${evCases.length}`, evCases)}
    >
      <CardHeader className="pb-1 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-yellow-500" />
          EV Overlay
        </CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-end gap-3">
          <span className="font-mono text-3xl font-bold text-yellow-500">{evCases.length}</span>
          <span className="font-mono text-xs text-muted-foreground mb-1">EV cases ({evPct}%)</span>
        </div>
        <div className="mt-2 h-1.5 bg-muted/30 rounded-full overflow-hidden">
          <div className="h-1.5 bg-yellow-500 rounded-full transition-all" style={{ width: `${evPct}%` }} />
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/50 mt-1">{nonEvCases.length} ICE / hybrid</p>
      </CardContent>
    </Card>
  );
}
