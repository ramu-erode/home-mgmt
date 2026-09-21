import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import { SyncService } from '../data/sync.service';

/**
 * First launch: "whose phone is this?" (ADR-014). The household shares one
 * Tailscale login, so edits are attributed to the phone, and the phone to a
 * member. On the very first install there are no members yet, so they can be
 * added here.
 */
@Component({
  selector: 'app-device-setup',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h1>Set up this phone</h1>
      <p class="muted">Changes made here are labelled with this phone's name.</p>

      <label>
        Phone name
        <input [(ngModel)]="name" name="name" placeholder="e.g. Priya's phone" autocomplete="off" />
      </label>

      <fieldset>
        <legend>Whose phone is this?</legend>
        @for (m of household.members(); track m.id) {
          <label class="choice"><input type="radio" name="member" [value]="m.id" [(ngModel)]="memberId" /> {{ m.name }}</label>
        } @empty {
          <p class="muted">No household members yet — add them first.</p>
        }
        <div class="row">
          <input [(ngModel)]="newMember" name="newMember" placeholder="Add a member" autocomplete="off" (keydown.enter)="addMember()" />
          <button type="button" (click)="addMember()" [disabled]="!newMember().trim()">Add</button>
        </div>
      </fieldset>

      <button type="button" class="primary" (click)="save()" [disabled]="!name().trim() || !memberId()">Start</button>
    </section>
  `,
})
export class DeviceSetup {
  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);
  private readonly sync = inject(SyncService);

  protected readonly name = signal('');
  protected readonly memberId = signal<string | null>(null);
  protected readonly newMember = signal('');

  protected async addMember(): Promise<void> {
    const name = this.newMember().trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await this.store.save('member', { id, name, displayOrder: this.household.members().length + 1 });
    this.newMember.set('');
    this.memberId.set(id);
  }

  protected async save(): Promise<void> {
    await this.store.save('device', { id: await this.sync.deviceId(), name: this.name().trim(), memberId: this.memberId() });
  }
}
