import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { SampleTag } from './sample-tag';

interface Props { cases: Case[] }

export function SettlementRate({ cases }: Props) {
  const { rate, settled, total, isSample } = useMemo(() => {
    const withOutcome = cases.filter((c) => c.outcome && c.extraction_status !== 'low_confidence');
    const settled = withOutcome.filter((c) => c.outcome === 'Settled / Withdrawn').length;
    const total = withOutcome.length;
    const rate = total > 0 ? Math.round((settled / total) * 100) : 0;
    const isSample = cases.some((c) => c.extraction_status === 'sample') &&
                     !cases.some((c) => c.extraction_status === 'full');
    return { rate, settled, total, isSample };
  }, [cases]);

  if (total === 0) {
    return (
      <Card className="h-full bg-card border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Settlement rate</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[100px] text-xs text-muted-foreground/50">Extraction pending</CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-foreground">Settlement rate</CardTitle>
        {isSample && <SampleTag />}
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3 mb-3">
          <span className="font-mono text-4xl font-bold text-foreground">{rate}%</span>
          <span className="font-mono text-xs text-muted-foreground mb-1.5">settled / withdrawn</span>
        </div>
        <div className="h-2 bg-muted/30 rounded-full overflow-hidden mb-2">
          <div className="h-2 bg-green-500 rounded-full transition-all" style={{ width: `${rate}%` }} />
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/50">{settled} of {total} extracted cases settled or withdrawn</p>
      </CardContent>
    </Card>
  );
}
