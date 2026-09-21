import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { liveQuery } from 'dexie';

/**
 * A Dexie live query as a signal: re-runs whenever the tables it read change,
 * whether the change came from this screen, another screen, or a sync. The UI
 * reads IndexedDB only, never the network (ADR-006).
 *
 * Must be called in an injection context. The query must only read: Dexie
 * refuses writes inside a live query, and an errored subscription never
 * recovers — the signal would silently freeze at its last value.
 */
export function liveSignal<T>(query: () => T | Promise<T>, initial: T): Signal<T> {
  const value = signal(initial);
  const subscription = liveQuery(query).subscribe({
    next: (v) => value.set(v),
    error: (e) => console.error('live query failed', e),
  });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  return value.asReadonly();
}
