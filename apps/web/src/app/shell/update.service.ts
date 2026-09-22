import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { SyncService } from '../data/sync.service';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * New versions of the app (ADR-005, ADR-009). The service worker fetches a new
 * version in the background; this announces it and swaps only when the person
 * says so — never mid-edit. A 426 from the Mac means this bundle can no longer
 * sync, so it looks for the new one straight away; the outbox waits for it.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  private readonly sync = inject(SyncService);

  /** A new version is downloaded and waiting. */
  readonly ready = signal(false);
  /** The cached app is broken (evicted files); only a reload recovers it. */
  readonly broken = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    const subs = [
      this.sw.versionUpdates.subscribe((e) => e.type === 'VERSION_READY' && this.ready.set(true)),
      this.sw.unrecoverable.subscribe(() => this.broken.set(true)),
    ];
    const timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void this.check();
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      subs.forEach((s) => s.unsubscribe());
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });

    effect(() => {
      if (this.sync.status() === 'update-required') void this.check();
    });
  }

  async check(): Promise<void> {
    if (!this.sw.isEnabled) return;
    try {
      if (await this.sw.checkForUpdate()) this.ready.set(true);
    } catch {
      // Offline or the Mac is down — the next check will do.
    }
  }

  /** Switches to the new version. Unsynced changes are in IndexedDB and survive the reload. */
  async apply(): Promise<void> {
    if (this.sw.isEnabled && this.ready()) await this.sw.activateUpdate();
    location.reload();
  }
}
