import { createContext, useContext, useState, ReactNode } from 'react';
import { Case } from '@workspace/api-client-react';

export type Scope = 'PENDING' | 'DISPOSED' | 'COMBINED';
export type Lens = 'PUBLIC_REGISTRY' | 'INTERNAL_RECORDS';
export type Region = 'All' | 'North' | 'South' | 'East' | 'West' | 'National';
export type View = 'Overview' | 'Issues & Parties' | 'Case Search';

interface DrawerState {
  isOpen: boolean;
  title: string;
  cases: Case[];
}

interface DashboardContextType {
  scope: Scope;
  setScope: (s: Scope) => void;
  lens: Lens;
  setLens: (l: Lens) => void;
  region: Region;
  setRegion: (r: Region) => void;
  view: View;
  setView: (v: View) => void;
  drawer: DrawerState;
  openDrawer: (title: string, cases: Case[]) => void;
  closeDrawer: () => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>('PENDING');
  const [lens, setLens] = useState<Lens>('PUBLIC_REGISTRY');
  const [region, setRegion] = useState<Region>('All');
  const [view, setView] = useState<View>('Overview');
  const [drawer, setDrawer] = useState<DrawerState>({ isOpen: false, title: '', cases: [] });

  const openDrawer = (title: string, cases: Case[]) => {
    setDrawer({ isOpen: true, title, cases });
  };

  const closeDrawer = () => {
    setDrawer((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <DashboardContext.Provider
      value={{
        scope,
        setScope,
        lens,
        setLens,
        region,
        setRegion,
        view,
        setView,
        drawer,
        openDrawer,
        closeDrawer,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
