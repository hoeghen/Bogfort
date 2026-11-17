import { useEffect, useState, useSyncExternalStore } from 'react';
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** Subscribe to a query. Pass null to stay idle. `key` must change when the query does. */
export function useLiveQuery<T>(query: Query | null, key: string): Live<(T & { id: string })[]> {
  const [state, setState] = useState<Live<(T & { id: string })[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      query,
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })),
          loading: false,
          error: null,
        }),
      (error) => setState({ data: [], loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useLiveDoc<T>(ref: DocumentReference | null, key: string): Live<T | null> {
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? (snap.data() as T) : null, loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
