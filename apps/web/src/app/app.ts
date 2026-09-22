import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Household } from './data/household';
import { SyncService } from './data/sync.service';
import { DeviceSetup } from './shell/device-setup';
import { SyncBadge } from './shell/sync-badge';
import { UpdateService } from './shell/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SyncBadge, DeviceSetup],
  template: `
    <header class="bar">
      <span class="brand">Home Mgmt</span>
      <app-sync-badge />
    </header>

    @if (update.ready() || update.broken()) {
      <div class="update" role="status">
        <span>{{ update.broken() ? 'The app needs to reload to recover.' : 'A new version is ready.' }}</span>
        <button type="button" class="primary" (click)="update.apply()">Reload</button>
      </div>
    }

    @if (household.deviceReady()) {
      <main><router-outlet /></main>
      <nav class="tabs" aria-label="Sections">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
        <a routerLink="/month" routerLinkActive="active">Month</a>
        <a routerLink="/cashflow" routerLinkActive="active">Cashflow</a>
        <a routerLink="/flows" routerLinkActive="active">Flows</a>
        <a routerLink="/more" routerLinkActive="active">More</a>
      </nav>
    } @else if (sync.settled()) {
      <main><app-device-setup /></main>
    } @else {
      <main><p class="muted">Loading…</p></main>
    }
  `,
})
export class App {
  protected readonly household = inject(Household);
  protected readonly sync = inject(SyncService);
  protected readonly update = inject(UpdateService);

  constructor() {
    this.sync.start();
  }
}
