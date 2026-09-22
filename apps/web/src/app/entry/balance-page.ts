import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import type { BalanceSnapshotRow } from '../data/rows';
import type { Money } from '@home-mgmt/shared';
import { formatDate, formatMoney, parseMoney, today } from '../format';
import { checkSnapshot, snapshotRow, type SnapshotInput } from './entry-model';

/**
 * Where the money stands (ADR-011). Each entry is a new snapshot — the latest
 * anchors the forecast, older ones stay as history. The form shows the
 * three-way split as you type and refuses one that does not add up.
 */
@Component({
  selector: 'app-balance-page',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Balance</h1></div>

    @if (latest(); as s) {
      <section class="card current">
        <span class="label">Forecast starts from</span>
        <span class="value">{{ formatMoney(s.balance) }}</span>
        <span class="muted">on {{ formatDate(s.asOf) }} · {{ formatMoney(s.reservedAmount) }} set aside for bills</span>
      </section>
    } @else {
      <p class="hint">No balance yet — the forecast starts from ₹0 until you enter one.</p>
    }

    <section class="card form">
      <h2>{{ latest() ? 'Update the balance' : 'Enter the balance' }}</h2>
      <label>
        Total across accounts
        <input inputmode="decimal" [ngModel]="input().balanceText" (ngModelChange)="patch({ balanceText: $event })" name="balance" placeholder="0.00" autocomplete="off" />
      </label>
      <label>
        Of that, already set aside for upcoming bills
        <input inputmode="decimal" [ngModel]="input().reservedText" (ngModelChange)="patch({ reservedText: $event })" name="reserved" placeholder="0.00" autocomplete="off" />
      </label>
      <label>
        As of
        <input type="date" [ngModel]="input().asOf" (ngModelChange)="patch({ asOf: $event })" name="asOf" />
      </label>

      <table class="split" aria-label="How the balance splits">
        <tbody>
          <tr><th scope="row">Set aside for bills</th><td>{{ money(input().reservedText) }}</td></tr>
          <tr><th scope="row">Saved towards goals</th><td>{{ formatMoney(check().goalsSaved) }}</td></tr>
          <tr class="free" [class.bad]="check().free?.startsWith('-')"><th scope="row">Free</th><td>{{ check().free ? formatMoney(check().free!) : '—' }}</td></tr>
        </tbody>
      </table>

      @if (touched() && check().problems.length) {
        <ul class="problems">@for (p of check().problems; track p) { <li>{{ p }}</li> }</ul>
      }
      <button type="button" class="primary" (click)="save()" [disabled]="check().problems.length > 0">Save balance</button>
      <p class="hint">Goal savings are counted from the Goals screen, so they are not typed here.</p>
    </section>

    @if (history().length > 1) {
      <section class="card">
        <h2>Earlier</h2>
        @for (s of history().slice(1); track s.id) {
          <div class="row past">
            <span>{{ formatDate(s.asOf) }}</span>
            <span class="amount">{{ formatMoney(s.balance) }}</span>
            <button type="button" class="link danger-text" (click)="remove(s)">Remove</button>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .current { display: grid; gap: 0.15rem; }
    .current .label { color: var(--muted); font-size: 0.9rem; }
    .current .value { font-size: 1.8rem; font-weight: 650; }
    .form { display: grid; gap: 0.75rem; }
    .split { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .split th { text-align: left; font-weight: 400; color: var(--muted); padding: 0.2rem 0; }
    .split td { text-align: right; font-variant-numeric: tabular-nums; }
    .split .free th, .split .free td { color: var(--text); font-weight: 600; border-top: 1px solid var(--line); padding-top: 0.4rem; }
    .split .free.bad td { color: var(--bad); }
    .problems { color: var(--bad); margin: 0; padding-left: 1.1rem; }
    .past { justify-content: space-between; padding: 0.3rem 0; }
    .past .amount { flex: 1; text-align: right; font-variant-numeric: tabular-nums; }
  `,
})
export class BalancePage {
  private readonly household = inject(Household);
  private readonly store = inject(LocalStore);

  protected readonly input = signal<SnapshotInput>({ asOf: today(), balanceText: '', reservedText: '' });
  protected readonly touched = signal(false);

  protected readonly latest = this.household.snapshot;
  protected readonly history = this.household.snapshots;
  protected readonly check = computed(() => checkSnapshot(this.input(), this.household.goals()));

  protected patch(change: Partial<SnapshotInput>): void {
    this.touched.set(true);
    this.input.update((i) => ({ ...i, ...change }));
  }

  /** What is typed as set aside, shown as money; empty means nothing set aside. */
  protected money(text: string): string {
    if (text.trim() === '') return formatMoney('0.00' as Money);
    const m = parseMoney(text);
    return m ? formatMoney(m) : '—';
  }

  protected async save(): Promise<void> {
    this.touched.set(true);
    if (this.check().problems.length) return;
    await this.store.save('balanceSnapshot', snapshotRow(crypto.randomUUID(), this.input()));
    this.input.set({ asOf: today(), balanceText: '', reservedText: '' });
    this.touched.set(false);
  }

  protected async remove(s: BalanceSnapshotRow): Promise<void> {
    if (confirm(`Remove the balance from ${formatDate(s.asOf)}?`)) await this.store.remove('balanceSnapshot', s.id);
  }

  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
}
