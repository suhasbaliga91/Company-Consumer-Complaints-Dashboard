import { useMemo } from 'react';
import { useListCases } from '@workspace/api-client-react';

export type Scope = 'PENDING' | 'DISPOSED' | 'COMBINED';
export type Lens = 'PUBLIC_REGISTRY' | 'INTERNAL_RECORDS';

export function useCaseData(scope: Scope, region: string) {
  const { data: rawCases, isLoading, error } = useListCases();

  const filteredCases = useMemo(() => {
    if (!rawCases) return [];

    return rawCases.filter((c) => {
      // 1. Region filter
      if (region !== 'All' && c.region !== region) {
        return false;
      }

      // 2. Scope filter
      if (scope === 'PENDING' && c.canonical_stage === 'Disposed') {
        return false;
      }
      if (scope === 'DISPOSED' && c.canonical_stage !== 'Disposed') {
        return false;
      }

      return true;
    });
  }, [rawCases, scope, region]);

  return {
    cases: filteredCases,
    isLoading,
    error,
  };
}
