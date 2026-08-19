import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListCasesQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

const SSE_URL = '/api/cache/events';

// How long to wait before attempting a reconnect after the stream closes (ms).
const RECONNECT_DELAY_MS = 5_000;

/**
 * Opens a Server-Sent Events connection to the API server and automatically
 * re-fetches cases when a `cache-invalidated` event arrives.
 *
 * Mount this hook once near the top of the component tree (e.g. inside App).
 * It is a no-op when the EventSource API is unavailable.
 */
export function useAutoRefresh(): void {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return;
    }

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const es = new EventSource(SSE_URL);
      esRef.current = es;

      es.addEventListener('cache-invalidated', () => {
        if (cancelled) return;

        // Silently re-fetch all cases data in the background
        queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });

        toast({
          title: 'Data updated',
          description: 'New extraction results are now loaded.',
          duration: 4_000,
        });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [queryClient, toast]);
}
