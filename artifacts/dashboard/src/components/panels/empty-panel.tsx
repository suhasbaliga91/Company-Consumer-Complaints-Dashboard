import { BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function EmptyPanel({ title, message = 'No data for current filters' }: { title: string; message?: string }) {
  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[280px] flex flex-col items-center justify-center gap-3 text-center px-4">
        <BarChart2 className="w-8 h-8 text-muted-foreground/25" strokeWidth={1.5} />
        <span className="text-xs text-muted-foreground/50">{message}</span>
      </CardContent>
    </Card>
  );
}
