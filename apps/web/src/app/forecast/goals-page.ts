import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Money } from '@home-mgmt/shared';
import { monthOf } from '@home-mgmt/core';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import type { GoalRow } from '../data/rows';
import { addToSaved, goalProblems, goalRow, reprioritise, type GoalInput } from '../entry/entry-model';
import { formatDate, formatMoney, formatMonth, today } from '../format';
import { ForecastService } from './forecast.service';

/**
 * Goals compete with the reserve for what is left each month (ADR-011): bills
 * first, then goals in priority order. A goal whose funding falls short shows
 * when it will actually get there. Saved amounts are kept by hand — there is
 * no ledger yet.
 */
@Component({
  selector: 'app-goals-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './goals-page.html',
  styles: `
    .goal { display: grid; gap: 0.4rem; }
    .line { display: flex; justify-content: space-between; gap: 1rem; font-variant-numeric: tabular-nums; }
    .meter { height: 0.5rem; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: var(--accent); border-radius: 999px; }
    .fill.behind { background: var(--warn); }
    .plan, .status { margin: 0; font-size: 0.9rem; }
    .status { color: var(--ok); }
    .status.bad { color: var(--bad); }
    .topup { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem; }
    .topup input, .topup button { min-height: 2.2rem; font-size: 0.9rem; }
    .tools { display: flex; gap: 0.6rem; align-items: center; }
    .tools .icon { min-height: 2.2rem; }
    .tools .link { margin-left: 0.4rem; }
    .form { display: grid; gap: 0.7rem; }
    .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .problems { color: var(--bad); margin: 0; padding-left: 1.1rem; }
    .warning { border-color: var(--bad); color: var(--bad); }
  `,
})
export class GoalsPage {
  private readonly forecast = inject(ForecastService);
  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);

  /** The goal being added or edited, or null. */
  protected readonly editing = signal<GoalInput | null>(null);
  protected readonly editingIsNew = signal(false);
  protected readonly topUp = signal<Record<string, string>>({});

  protected readonly error = computed(() => this.forecast.result().error);
  protected readonly problems = computed(() => {
    const e = this.editing();
    return e ? goalProblems(e) : [];
  });

  protected readonly goals = computed(() => {
    const result = this.forecast.result().forecast;
    const first = result?.months[0];
    return this.household.goals().map((g) => {
      const month = first?.goals.find((x) => x.goalId === g.id);
      const completion = result?.goals.find((x) => x.goalId === g.id)?.projectedCompletion ?? null;
      const slipping = completion === null || completion > monthOf(g.targetDate);
      // A bar width, not an amount — the one place a float of Money is harmless (ADR-012).
      const percent = Math.min(100, Math.round((Number(g.savedAmount) / Number(g.targetAmount)) * 100));
      const verdict =
        completion === null
          ? 'Not reached within the next 18 months at the current pace.'
          : slipping
            ? `Reaches the target in ${formatMonth(completion, 'long')} — after the target date.`
            : `On track — reaches the target in ${formatMonth(completion, 'long')}.`;
      return { row: g, percent, required: month?.required === '0.00' ? null : month?.required, funded: month?.funded, slipping, verdict };
    });
  });

  protected startNew(): void {
    const next = Math.max(0, ...this.household.goals().map((g) => g.priority)) + 1;
    const inAYear = `${Number(today().slice(0, 4)) + 1}${today().slice(4)}`;
    this.editing.set({ id: crypto.randomUUID(), name: '', memberId: null, targetText: '', targetDate: inAYear, savedText: '', priority: next });
    this.editingIsNew.set(true);
  }

  protected startEdit(g: GoalRow): void {
    this.editing.set({ id: g.id, name: g.name, memberId: g.memberId, targetText: g.targetAmount, targetDate: g.targetDate, savedText: g.savedAmount, priority: g.priority });
    this.editingIsNew.set(false);
  }

  protected patch(change: Partial<GoalInput>): void {
    this.editing.update((e) => (e ? { ...e, ...change } : e));
  }

  protected async save(): Promise<void> {
    const e = this.editing();
    if (!e || this.problems().length) return;
    await this.store.save('goal', goalRow(e));
    this.editing.set(null);
  }

  protected async remove(g: GoalRow): Promise<void> {
    if (confirm(`Remove the goal "${g.name}"? What is saved towards it becomes free money in the forecast.`)) await this.store.remove('goal', g.id);
  }

  protected setTopUp(id: string, text: string): void {
    this.topUp.update((t) => ({ ...t, [id]: text }));
  }

  protected async addSaved(g: GoalRow): Promise<void> {
    const row = addToSaved(g, this.topUp()[g.id] ?? '');
    if (!row) return;
    await this.store.save('goal', row);
    this.setTopUp(g.id, '');
  }

  protected async move(g: GoalRow, by: -1 | 1): Promise<void> {
    await this.store.save('goal', ...reprioritise(this.household.goals(), g.id, by));
  }

  protected readonly zero = '0.00' as Money;
  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
}
