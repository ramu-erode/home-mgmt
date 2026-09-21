import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import type { MemberRow } from '../data/rows';

/** People flows are attributed to — including those who never use the app (ADR-010). */
@Component({
  selector: 'app-members-page',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Members</h1></div>
    <section class="card">
      @for (m of household.members(); track m.id; let first = $first; let last = $last) {
        <div class="row item">
          <input [ngModel]="m.name" (change)="rename(m, $any($event.target).value)" [name]="'n' + m.id" aria-label="Name" />
          <button type="button" class="icon" (click)="move(m, -1)" [disabled]="first" aria-label="Move up">↑</button>
          <button type="button" class="icon" (click)="move(m, 1)" [disabled]="last" aria-label="Move down">↓</button>
          <button type="button" class="link danger-text" (click)="remove(m)">Remove</button>
        </div>
      } @empty {
        <p class="muted">No members yet.</p>
      }
      <div class="row">
        <input [(ngModel)]="newName" name="new" placeholder="Add a member" autocomplete="off" (keydown.enter)="add()" />
        <button type="button" (click)="add()" [disabled]="!newName().trim()">Add</button>
      </div>
    </section>
  `,
  styles: `.item { margin-bottom: 0.5rem; } .item input { flex: 1; }`,
})
export class MembersPage {
  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);
  protected readonly newName = signal('');

  protected async add(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    const order = Math.max(0, ...this.household.members().map((m) => m.displayOrder)) + 1;
    await this.store.save('member', { id: crypto.randomUUID(), name, displayOrder: order });
    this.newName.set('');
  }

  protected async rename(m: MemberRow, name: string): Promise<void> {
    if (name.trim() && name.trim() !== m.name) await this.store.save('member', { id: m.id, name: name.trim(), displayOrder: m.displayOrder });
  }

  /** Moves one place and renumbers 1…n, writing only the rows whose position changed. */
  protected async move(m: MemberRow, by: -1 | 1): Promise<void> {
    const list = [...this.household.members()];
    const i = list.findIndex((x) => x.id === m.id);
    if (!list[i + by]) return;
    [list[i], list[i + by]] = [list[i + by], list[i]];
    const changed = list.map((x, n) => ({ id: x.id, name: x.name, displayOrder: n + 1 })).filter((x, n) => list[n].displayOrder !== x.displayOrder);
    await this.store.save('member', ...changed);
  }

  protected async remove(m: MemberRow): Promise<void> {
    const used = this.household.flows().some((f) => f.allocations.some((a) => a.memberId === m.id));
    const warning = used ? ' Some flows are allocated to them; those shares will point at a removed member.' : '';
    if (confirm(`Remove ${m.name}?${warning}`)) await this.store.remove('member', m.id);
  }
}
