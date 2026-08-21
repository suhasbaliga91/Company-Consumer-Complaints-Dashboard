import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export function PrecedentRecall() {
  return (
    <Card className="h-full bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-muted-foreground font-normal tracking-wide uppercase">Precedent Recall</CardTitle>
      </CardHeader>
      <CardContent className="pt-4 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search orders, judgements, and arguments..." 
            className="pl-9 bg-muted/20 border-border/50 font-mono text-sm focus-visible:ring-primary"
            disabled
          />
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[200px] text-sm text-muted-foreground/50 font-mono text-center px-4 border border-dashed border-border/30 rounded-sm bg-muted/5">
          Full-corpus search available after extraction run
        </div>
      </CardContent>
    </Card>
  );
}
