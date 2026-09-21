import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isCivilDate, type OccurrenceCommand } from '@home-mgmt/shared';
import { LocalStore } from '../data/local-store';
import { formatMoney, parseMoney, today } from '../format';
import type { ForecastOccurrence } from './forecast-items';

/**
 * What a person can do to one occurrence (ADR-009 commands). Applied on the
 * phone first with the server's own rules; a refusal shows here immediately.
 */
@Component({
  selector: 'app-occurrence-actions',
  imports: [FormsModule],
  template: `
    @if (occurrence().preview) {
      <p class="muted">This one exists only as a preview until the Mac has seen the change — sync, then it can be confirmed or settled.</p>
    } @else {
      <div class="actions">
        @switch (occurrence().status) {
          @case ('PLANNED') {
            <button type="button" (click)="run({ command: 'confirm' })">Confirm</button>
            <button type="button" (click)="open('settle')">Paid…</button>
            <button type="button" (click)="run({ command: 'skip' })">Skip</button>
          }
          @case ('CONFIRMED') {
            <button type="button" (click)="open('settle')">Paid…</button>
            <button type="button" (click)="run({ command: 'skip' })">Skip</button>
          }
          @case ('SKIPPED') {
            <button type="button" (click)="run({ command: 'unskip' })">Unskip</button>
          }
          @case ('SETTLED') {
            <button type="button" (click)="open('settle')">Correct payment…</button>
          }
        }
        @if (occurrence().status !== 'SETTLED') {
          <button type="button" (click)="open('override')">Change…</button>
        }
        <button type="button" (click)="open('note')">Note…</button>
      </div>

      @switch (mode()) {
        @case ('settle') {
          <div class="form-row">
            <label>Paid <input inputmode="decimal" [(ngModel)]="amountText" name="paidAmount" /></label>
            <label>on <input type="date" [(ngModel)]="dateText" name="paidOn" /></label>
            <button type="button" class="primary" (click)="settle()">Save</button>
          </div>
        }
        @case ('override') {
          <div class="form-row">
            <label>Amount <input inputmode="decimal" [(ngModel)]="amountText" name="overrideAmount" /></label>
            <label>Due <input type="date" [(ngModel)]="dateText" name="overrideDate" /></label>
            <button type="button" class="primary" (click)="override()">Save</button>
          </div>
          <p class="hint">A change here sticks: later edits to the rule leave this one alone.</p>
        }
        @case ('note') {
          <div class="form-row">
            <label class="wide">Note <input [(ngModel)]="noteText" name="note" /></label>
            <button type="button" class="primary" (click)="run({ command: 'note', args: { text: noteText().trim() || null } })">Save</button>
          </div>
        }
      }
      @if (message()) { <p class="refusal" role="alert">{{ message() }}</p> }
    }
  `,
  styles: `
    .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .actions button { min-height: 2.2rem; padding: 0 0.8rem; font-size: 0.9rem; }
    .form-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) auto; gap: 0.5rem; align-items: end; margin-top: 0.6rem; }
    .form-row .wide { grid-column: span 2; }
    .refusal { color: var(--bad); margin: 0.5rem 0 0; }
  `,
})
export class OccurrenceActions {
  readonly occurrence = input.required<ForecastOccurrence>();
  private readonly store = inject(LocalStore);

  protected readonly mode = signal<'none' | 'settle' | 'override' | 'note'>('none');
  protected readonly message = signal<string | null>(null);
  protected readonly amountText = signal('');
  protected readonly dateText = signal('');
  protected readonly noteText = signal('');

  private readonly defaults = computed(() => {
    const o = this.occurrence();
    return { amount: o.amount, date: o.status === 'SETTLED' ? o.dueDate : today(), note: o.note ?? '' };
  });

  /** Opens a form pre-filled from the occurrence as it is now. */
  protected open(mode: 'settle' | 'override' | 'note'): void {
    const d = this.defaults();
    this.amountText.set(d.amount);
    this.dateText.set(mode === 'override' ? this.occurrence().dueDate : d.date);
    this.noteText.set(d.note);
    this.message.set(null);
    this.mode.set(mode);
  }

  protected async run(cmd: OccurrenceCommand): Promise<void> {
    this.message.set(await this.store.command(this.occurrence().id, cmd));
    if (!this.message()) this.mode.set('none');
  }

  protected settle(): Promise<void> | void {
    const amount = parseMoney(this.amountText());
    const on = this.dateText();
    if (!amount || !isCivilDate(on)) return this.message.set('Enter the amount paid and the date.');
    return this.run({ command: 'settle', args: { on, amount } });
  }

  protected override(): Promise<void> | void {
    const o = this.occurrence();
    const amount = parseMoney(this.amountText());
    const dueDate = this.dateText();
    if (!amount || !isCivilDate(dueDate)) return this.message.set('Enter a valid amount and date.');
    const args = {
      ...(amount !== o.amount && { amount }),
      ...(dueDate !== o.dueDate && { dueDate }),
    };
    if (Object.keys(args).length === 0) return this.mode.set('none');
    return this.run({ command: 'override', args });
  }

  protected readonly formatMoney = formatMoney;
}
