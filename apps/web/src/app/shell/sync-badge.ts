import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { SyncService } from '../data/sync.service';
import { UpdateService } from './update.service';

/**
 * Sync state, always visible (ADR-006): unsynced edits live only on this phone
 * until the Mac accepts them, so "saved" must never look like "safe". Every
 * rejection is shown until dismissed (ADR-009).
 */
@Component({
  selector: 'app-sync-badge',
  template: `
    <button type="button" class="badge" [class]="tone()" (click)="open.set(!open())" [attr.aria-expanded]="open()">
      {{ label() }}
    </button>
    @if (open()) {
      <div class="panel" role="dialog" aria-label="Sync details">
        <p>{{ detail() }}</p>
        @if (sync.status() === 'update-required') {
          <button type="button" (click)="reload()">Reload to update</button>
        } @else {
          <button type="button" (click)="sync.run()" [disabled]="sync.busy()">Sync now</button>
        }
        @for (r of sync.rejections(); track r.id) {
          <div class="rejection">
            <strong>A change to {{ r.table }} was not accepted.</strong>
            <span>{{ r.message }}</span>
            <button type="button" class="link" (click)="sync.dismissRejection(r.id)">Dismiss</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; }
    .badge { border: 0; border-radius: 999px; padding: 0.3rem 0.75rem; font-size: 0.8rem; background: var(--surface-2); color: var(--text); }
    .badge.ok { background: var(--ok-bg); color: var(--ok); }
    .badge.warn { background: var(--warn-bg); color: var(--warn); }
    .badge.bad { background: var(--bad-bg); color: var(--bad); }
    .panel { position: absolute; right: 0; top: 2.4rem; width: min(20rem, 90vw); background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.9rem; box-shadow: var(--shadow); z-index: 10; display: grid; gap: 0.6rem; }
    .panel p { margin: 0; color: var(--muted); }
    .rejection { display: grid; gap: 0.2rem; border-top: 1px solid var(--line); padding-top: 0.6rem; font-size: 0.85rem; }
  `,
})
export class SyncBadge {
  protected readonly sync = inject(SyncService);
  private readonly update = inject(UpdateService);
  protected readonly open = signal(false);
  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private readonly ago = computed(() => {
    const at = this.sync.lastSyncedAt();
    if (!at) return null;
    const minutes = Math.floor((this.now() - Date.parse(at)) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
  });

  protected readonly label = computed(() => {
    const pending = this.sync.pending();
    const rejected = this.sync.rejections().length;
    if (rejected) return `${rejected} not accepted`;
    switch (this.sync.status()) {
      case 'update-required':
        return 'Update ready';
      case 'syncing':
        return 'Syncing…';
      case 'offline':
        return pending ? `Offline · ${pending} unsynced` : 'Offline';
      case 'error':
        return 'Sync error';
      default:
        return pending ? `${pending} unsynced` : this.ago() ? `Synced ${this.ago()}` : 'Not synced yet';
    }
  });

  protected readonly tone = computed(() => {
    if (this.sync.rejections().length || this.sync.status() === 'error') return 'bad';
    if (this.sync.pending() || this.sync.status() !== 'idle') return 'warn';
    return this.sync.lastSyncedAt() ? 'ok' : 'warn';
  });

  protected readonly detail = computed(() => {
    const pending = this.sync.pending();
    const last = this.ago() ? `Last synced ${this.ago()}.` : 'Never synced with the Mac.';
    const unsynced = pending ? ` ${pending} change${pending === 1 ? '' : 's'} exist only on this phone until the Mac is reachable.` : '';
    if (this.sync.status() === 'update-required') return 'A new version of the app is waiting. Your unsynced changes are kept.';
    if (this.sync.status() === 'error') return `${this.sync.error() ?? 'The Mac refused the sync.'}${unsynced}`;
    return `${last}${unsynced}`;
  });

  protected reload(): void {
    void this.update.apply();
  }
}
