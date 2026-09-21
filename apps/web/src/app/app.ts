import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Household } from './data/household';
import { SyncService } from './data/sync.service';
import { DeviceSetup } from './shell/device-setup';
import { SyncBadge } from './shell/sync-badge';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SyncBadge, DeviceSetup],
  template: `
    <header class="bar">
      <span class="brand">Home Mgmt</span>
      <app-sync-badge />
    </header>

    @if (household.deviceReady()) {
      <main><router-outlet /></main>
      <nav class="tabs" aria-label="Sections">
        <a routerLink="/flows" routerLinkActive="active">Flows</a>
        <a routerLink="/members" routerLinkActive="active">Members</a>
        <a routerLink="/categories" routerLinkActive="active">Categories</a>
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

  constructor() {
    this.sync.start();
  }
}
