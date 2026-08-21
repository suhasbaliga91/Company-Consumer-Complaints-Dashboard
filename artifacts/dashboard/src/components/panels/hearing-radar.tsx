import { useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Case } from '@workspace/api-client-react';
import { differenceInDays, format, addDays, startOfWeek, addWeeks, startOfMonth, addMonths } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type RadarMode = '7d' | '30d' | '365d';

/** Get the current date in IST (UTC+5:30) as a plain date string YYYY-MM-DD */
function getISTToday(): Date {
  const now = new Date();
  // IST = UTC + 5h30m = UTC + 330 minutes
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMs = now.getTime() + istOffsetMs - now.getTimezoneOffset() * 60 * 1000;
  const istDate = new Date(istMs);
  // Return a date object representing start-of-day in IST expressed as UTC midnight of that day
  return new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate()));
}

const PAGE_SIZE = 20;

export function HearingRadar({ cases }: { cases: Case[] }) {
  const { lens, scope, openDrawer } = useDashboard();
  const [mode, setMode] = useState<RadarMode>('7d');
  const [page, setPage] = useState(0);

  const { chartData, upcoming, totalUpcoming } = useMemo(() => {
    if (!cases) return { chartData: [], upcoming: [], totalUpcoming: 0 };

    const today = getISTToday();

    const validCases = cases.filter(c => c.next_hearing);

    // Build chart data per mode
    let chartData: { label: string; count: number; min: number; max: number }[] = [];

    if (mode === '7d') {
      // One bar per day for 7 days
      for (let d = 0; d < 7; d++) {
        const date = addDays(today, d);
        const label = format(date, 'MMM d');
        const count = validCases.filter(c => {
          const days = differenceInDays(new Date(c.next_hearing!), today);
          return days === d;
        }).length;
        chartData.push({ label, count, min: d, max: d });
      }
    } else if (mode === '30d') {
      // One bar per day for 30 days
      for (let d = 0; d < 30; d++) {
        const date = addDays(today, d);
        const label = format(date, 'MMM d');
        const count = validCases.filter(c => {
          const days = differenceInDays(new Date(c.next_hearing!), today);
          return days === d;
        }).length;
        chartData.push({ label, count, min: d, max: d });
      }
    } else {
      // One bar per month for 12 months
      for (let m = 0; m < 12; m++) {
        const monthStart = addMonths(today, m);
        const monthEnd = addMonths(today, m + 1);
        const label = format(monthStart, 'MMM yy');
        const count = validCases.filter(c => {
          const hearingDate = new Date(c.next_hearing!);
          return hearingDate >= monthStart && hearingDate < monthEnd;
        }).length;
        chartData.push({ label, count, min: m * 30, max: (m + 1) * 30 - 1 });
      }
    }

    // Upcoming list: all future hearings sorted ascending
    const upcomingAll = [...validCases]
      .filter(c => differenceInDays(new Date(c.next_hearing!), today) >= 0)
      .sort((a, b) => new Date(a.next_hearing!).getTime() - new Date(b.next_hearing!).getTime());

    return {
      chartData,
      upcoming: upcomingAll,
      totalUpcoming: upcomingAll.length,
    };
  }, [cases, mode]);

  const pageItems = upcoming.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(totalUpcoming / PAGE_SIZE);

  if (lens === 'INTERNAL_RECORDS') {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Hearing radar</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center text-sm text-muted-foreground/50">
          No source in this dataset
        </CardContent>
      </Card>
    );
  }

  if (scope === 'DISPOSED') {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Hearing radar</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center text-sm text-muted-foreground/50">
          No upcoming hearings
        </CardContent>
      </Card>
    );
  }

  const handleBarClick = (data: any) => {
    if (!data || !data.activePayload?.[0]) return;
    const bar = data.activePayload[0].payload as { label: string; count: number; min: number; max: number };
    const today = getISTToday();
    let barCases: Case[];
    if (mode === '365d') {
      const monthStart = addMonths(today, Math.floor(bar.min / 30));
      const monthEnd = addMonths(today, Math.floor(bar.min / 30) + 1);
      barCases = cases.filter(c => {
        if (!c.next_hearing) return false;
        const d = new Date(c.next_hearing);
        return d >= monthStart && d < monthEnd;
      });
    } else {
      barCases = cases.filter(c => {
        if (!c.next_hearing) return false;
        const days = differenceInDays(new Date(c.next_hearing), today);
        return days === bar.min;
      });
    }
    openDrawer(`${bar.label} — ${barCases.length} hearings`, barCases);
  };

  return (
    <Card className="bg-card border-border flex flex-col">
      <CardHeader className="pb-2 flex flex-row items-center justify-between flex-shrink-0 flex-wrap gap-2">
        <CardTitle className="text-sm font-semibold text-foreground">Hearing radar</CardTitle>
        <div className="flex gap-1 flex-wrap">
          {(['7d', '30d', '365d'] as RadarMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setPage(0); }}
              className={`px-2.5 min-h-[36px] text-[11px] font-medium rounded border transition-colors ${
                mode === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {m === '7d' ? 'Next 7 Days' : m === '30d' ? 'Next Month' : 'Next 365 Days'}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 pb-4">
        {/* Bar chart — horizontal scroll on small screens */}
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[480px] h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              onClick={handleBarClick}
              className="cursor-pointer"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)' }}
                interval={mode === '7d' ? 0 : mode === '30d' ? 4 : 0}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)' }}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px', fontFamily: 'var(--app-font-mono)', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Bar dataKey="count" name="Hearings" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Earliest hearings list */}
        <div className="flex flex-col min-h-0">
          <div className="text-xs font-mono text-muted-foreground mb-2 flex justify-between">
            <span>Earliest Hearings</span>
            <span>Forum</span>
          </div>
          <div className="space-y-0.5">
            {pageItems.map((c, i) => (
              <div
                key={c.case_number + i}
                className="flex items-center justify-between py-1.5 px-3 border border-transparent hover:border-border/50 hover:bg-muted/20 rounded-sm cursor-pointer transition-colors"
                onClick={() => openDrawer(`${c.case_number} details`, [c])}
              >
                <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                  <div className="font-mono text-xs text-foreground truncate">{c.case_number}</div>
                  <div className="font-sans text-[10px] text-muted-foreground truncate">{c.commission}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono text-xs text-chart-2">{format(new Date(c.next_hearing!), 'MMM dd')}</div>
                </div>
              </div>
            ))}
            {pageItems.length === 0 && (
              <div className="flex items-center justify-center py-6 text-xs font-mono text-muted-foreground">
                No upcoming hearings found
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 min-h-[44px]"
              >
                ← Prev
              </button>
              <span className="text-[10px] font-mono text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalUpcoming)} of {totalUpcoming}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 min-h-[44px]"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
