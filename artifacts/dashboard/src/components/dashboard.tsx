import { useCaseData } from '@/hooks/use-case-data';
import { useDashboard, Scope, Lens, Region, View } from '@/components/dashboard-context';
import { StateHeatboard } from '@/components/panels/state-heatboard';
import { EscalationLadder } from '@/components/panels/escalation-ladder';
import { FilingCohorts } from '@/components/panels/filing-cohorts';
import { HearingRadar } from '@/components/panels/hearing-radar';
import { KpiStrip } from '@/components/panels/kpi-strip';
import { EmptyPanel } from '@/components/panels/empty-panel';
import { DealershipWatchlist } from '@/components/panels/dealership-watchlist';
import { CounselWatchlist } from '@/components/panels/counsel-watchlist';
import { DrillDrawer } from '@/components/drill-drawer';
import { IssueMix } from '@/components/panels/issue-mix';
import { SalesService } from '@/components/panels/sales-service';
import { ProductLeague } from '@/components/panels/product-league';
import { PartsFailure } from '@/components/panels/parts-failure';
import { EvOverlay } from '@/components/panels/ev-overlay';
import { PendingCaseSearch } from '@/components/panels/pending-case-search';

import { StageDistribution } from '@/components/panels/stage-distribution';
import { DisposedDashboard } from '@/components/disposed-dashboard';
import { DocsModal } from '@/components/docs-modal';
import { Scale, Database, MapPin, Loader2, LayoutGrid, Users, Search, AlertCircle, BookOpen, Menu } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useState } from 'react';
import { APP_TITLE, APP_TITLE_SHORT } from '@/lib/branding';

export function Dashboard() {
  const { scope, setScope, lens, setLens, region, setRegion, view, setView } = useDashboard();
  const { cases, isLoading, error } = useCaseData(scope, region);
  const [docsOpen, setDocsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-destructive flex flex-col items-center gap-4">
          <AlertCircle className="w-12 h-12" />
          <p className="text-sm font-medium">Failed to load case data</p>
        </div>
      </div>
    );
  }

  const isInternal = lens === 'INTERNAL_RECORDS';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-white border-b border-border/60 shadow-sm">
        <div className="px-4 md:px-6 h-16 flex items-center justify-between gap-3">
          {/* Logo + Scope tabs */}
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <div className="flex items-center gap-2 text-primary flex-shrink-0">
              <Scale className="w-5 h-5" />
              <span className="font-semibold text-sm text-primary hidden sm:block">{APP_TITLE}</span>
              <span className="font-semibold text-sm text-primary sm:hidden">{APP_TITLE_SHORT}</span>
            </div>
            <div className="h-4 w-px bg-border mx-1 hidden md:block" />
            <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)} className="w-[180px] md:w-[200px]">
              <TabsList className="grid w-full grid-cols-2 bg-muted border border-border h-9 p-1 rounded-lg">
                <TabsTrigger
                  value="PENDING"
                  className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md transition-colors duration-150 min-h-[28px]"
                >
                  Pending
                </TabsTrigger>
                <TabsTrigger
                  value="DISPOSED"
                  className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md transition-colors duration-150 min-h-[28px]"
                >
                  Disposed
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Desktop right-hand controls */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => setDocsOpen(true)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium text-muted-foreground border border-border bg-white hover:bg-muted hover:text-foreground transition-colors duration-150"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Docs
            </button>

            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <Select value={lens} onValueChange={(v) => setLens(v as Lens)}>
                <SelectTrigger className="w-[180px] h-9 text-xs bg-white border-border rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC_REGISTRY" className="text-xs">Public Registry</SelectItem>
                  <SelectItem value="INTERNAL_RECORDS" className="text-xs" disabled>Internal Records (Coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger className="w-[140px] h-9 text-xs bg-white border-border rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-xs">All Regions</SelectItem>
                  <SelectItem value="North" className="text-xs">North</SelectItem>
                  <SelectItem value="South" className="text-xs">South</SelectItem>
                  <SelectItem value="East" className="text-xs">East</SelectItem>
                  <SelectItem value="West" className="text-xs">West</SelectItem>
                  <SelectItem value="National" className="text-xs">NCDRC-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Secondary View Navigation */}
        {scope === 'PENDING' && (
          <div className="px-4 md:px-6 py-2 border-t border-border/40 bg-muted/30 flex items-center justify-between gap-2">
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 min-w-max">
                <ViewPill active={view === 'Overview'} onClick={() => setView('Overview')} icon={<LayoutGrid className="w-3.5 h-3.5" />} label="Overview" />
                <ViewPill active={view === 'Issues & Parties'} onClick={() => setView('Issues & Parties')} icon={<Users className="w-3.5 h-3.5" />} label="Issues & Parties" />
                <ViewPill active={view === 'Case Search'} onClick={() => setView('Case Search')} icon={<Search className="w-3.5 h-3.5" />} label="Case Search" />
              </div>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs flex-shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">Processing corpus...</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground flex-shrink-0">
                <span className="text-foreground font-medium">{cases.length.toLocaleString()}</span> <span className="hidden sm:inline">active</span> records
              </div>
            )}
          </div>
        )}
        {scope === 'DISPOSED' && (
          <div className="px-4 md:px-6 py-2 border-t border-border/40 bg-muted/30 flex items-center justify-end">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing corpus...
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{cases.length.toLocaleString()}</span> disposed records
              </div>
            )}
          </div>
        )}
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 pt-4 md:pt-5 pb-8 px-4 md:px-6 flex flex-col gap-4 md:gap-5 overflow-x-hidden">
        {isLoading ? (
          <DashboardSkeleton scope={scope} />
        ) : scope === 'DISPOSED' ? (
          <div className="animate-in fade-in duration-200">
            <DisposedDashboard cases={cases} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 md:gap-5 animate-in fade-in duration-200">
            <KpiStrip cases={cases} />

            {view === 'Overview' && (
              <div className="flex flex-col gap-4 md:gap-5">
                {/* Row 1: Heatboard + Radar */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 md:min-h-[380px]">
                  <div className="md:col-span-1">
                    <StateHeatboard cases={cases} />
                  </div>
                  <div className="md:col-span-2">
                    <HearingRadar cases={cases} />
                  </div>
                </div>
                {/* Row 2: Bottom panels */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 md:min-h-[320px]">
                  <EscalationLadder cases={cases} />
                  <StageDistribution cases={cases} />
                  <FilingCohorts cases={cases} />
                </div>
              </div>
            )}

            {view === 'Issues & Parties' && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-5">
                <div className="lg:col-span-2 flex flex-col gap-4 md:gap-5">
                  <div>
                    {isInternal
                      ? <EmptyPanel title="Issue Mix" message="No source in this dataset" />
                      : <IssueMix cases={cases} />}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                    {isInternal
                      ? <EmptyPanel title="Sales vs Service" message="No source in this dataset" />
                      : <SalesService cases={cases} />}
                    {isInternal
                      ? <EmptyPanel title="Product League" message="No source in this dataset" />
                      : <ProductLeague cases={cases} />}
                  </div>
                </div>
                <div className="lg:col-span-1 flex flex-col gap-4 md:gap-5">
                  <div>
                    {isInternal
                      ? <EmptyPanel title="Dealership Watchlist" message="No source in this dataset" />
                      : <DealershipWatchlist cases={cases} />}
                  </div>
                  <div>
                    {isInternal
                      ? <EmptyPanel title="Parts-Failure Tracker" message="No source in this dataset" />
                      : <PartsFailure cases={cases} />}
                  </div>
                </div>
                <div className="lg:col-span-1 flex flex-col gap-4 md:gap-5">
                  <div>
                    {isInternal
                      ? <EmptyPanel title="Counsel Watchlist" message="No source in this dataset" />
                      : <CounselWatchlist cases={cases} />}
                  </div>
                  <div>
                    {isInternal
                      ? <EmptyPanel title="EV Overlay" message="No source in this dataset" />
                      : <EvOverlay cases={cases} />}
                  </div>
                </div>
              </div>
            )}

            {view === 'Case Search' && (
              <PendingCaseSearch cases={cases} />
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-border bg-white px-4 md:px-6 py-2.5 flex items-center justify-end">
        <span className="text-xs text-muted-foreground font-mono">
          Created by <span style={{ color: '#6b7c3a' }} className="font-medium">Managed Counsel</span>
        </span>
      </footer>

      <DrillDrawer />
      <DocsModal open={docsOpen} onOpenChange={setDocsOpen} />

      {/* Mobile menu sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="bottom" className="p-0 rounded-t-2xl max-h-[85vh]">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/60">
            <SheetTitle className="text-sm font-semibold text-foreground">Filters &amp; Options</SheetTitle>
          </SheetHeader>
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
            {/* Docs */}
            <button
              onClick={() => { setDocsOpen(true); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-4 min-h-[44px] rounded-lg text-sm font-medium text-muted-foreground border border-border bg-white hover:bg-muted hover:text-foreground transition-colors duration-150"
            >
              <BookOpen className="w-4 h-4" />
              Documentation
            </button>

            {/* Lens */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                <Database className="w-3.5 h-3.5" />
                Data Source
              </label>
              <Select value={lens} onValueChange={(v) => { setLens(v as Lens); }}>
                <SelectTrigger className="w-full min-h-[44px] text-sm bg-white border-border rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC_REGISTRY" className="text-sm min-h-[44px]">Public Registry</SelectItem>
                  <SelectItem value="INTERNAL_RECORDS" className="text-sm min-h-[44px]" disabled>Internal Records (Coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Region */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5" />
                Region
              </label>
              <Select value={region} onValueChange={(v) => { setRegion(v as Region); }}>
                <SelectTrigger className="w-full min-h-[44px] text-sm bg-white border-border rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-sm min-h-[44px]">All Regions</SelectItem>
                  <SelectItem value="North" className="text-sm min-h-[44px]">North</SelectItem>
                  <SelectItem value="South" className="text-sm min-h-[44px]">South</SelectItem>
                  <SelectItem value="East" className="text-sm min-h-[44px]">East</SelectItem>
                  <SelectItem value="West" className="text-sm min-h-[44px]">West</SelectItem>
                  <SelectItem value="National" className="text-sm min-h-[44px]">NCDRC-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Pulsing layout skeleton shown while /api/cases is loading. */
function DashboardSkeleton({ scope }: { scope: Scope }) {
  const isDisposed = scope === 'DISPOSED';
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {/* KPI strip — 4 metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* Row 1: two equal panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>

      {/* Row 2: two equal panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>

      {/* Disposed has extra rows */}
      {isDisposed && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </>
      )}

      {/* Loading label */}
      <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Processing {isDisposed ? 'disposed' : 'active'} case corpus…</span>
      </div>
    </div>
  );
}

function ViewPill({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 min-h-[36px] rounded-md text-xs font-medium transition-colors duration-150 ${
        active
          ? 'bg-white text-primary shadow-sm border border-border/60'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/60'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
