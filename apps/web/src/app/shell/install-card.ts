import { Component, inject } from '@angular/core';
import { SyncService } from '../data/sync.service';
import { InstallService } from './install.service';

/**
 * Shown until the app is on the home screen. Not a nicety: in a browser tab,
 * Safari may clear this phone's copy — including changes not yet synced.
 */
@Component({
  selector: 'app-install-card',
  template: `
    @if (!install.installed()) {
      <section class="card install">
        <strong>Add Home Mgmt to your home screen</strong>
        <p>
          In a browser tab the phone may delete its copy of the household
          @if (sync.pending()) { — including <b>{{ sync.pending() }} unsynced change{{ sync.pending() === 1 ? '' : 's' }}</b> }.
          Installed, it stays, and opens without the Mac.
        </p>
        @if (install.canPrompt()) {
          <button type="button" class="primary" (click)="install.prompt()">Install</button>
        } @else if (install.ios) {
          <p class="how">In Safari: tap <b>Share</b> <span aria-hidden="true">⎋</span>, then <b>Add to Home Screen</b>.</p>
        } @else {
          <p class="how">Use your browser's menu: <b>Install app</b> or <b>Add to Home screen</b>.</p>
        }
      </section>
    }
  `,
  styles: `
    .install { border-color: var(--warn); background: var(--warn-bg); display: grid; gap: 0.4rem; }
    .install p { margin: 0; font-size: 0.9rem; }
    .how { color: var(--muted); }
  `,
})
export class InstallCard {
  protected readonly install = inject(InstallService);
  protected readonly sync = inject(SyncService);
}
