import { Component, computed, inject } from '@angular/core';
import type { Money } from '@home-mgmt/shared';
import { monthOf } from '@home-mgmt/core';
import { Household } from '../data/household';
import { formatDate, formatMoney, formatMonth } from '../format';
import { ForecastService } from './forecast.service';

/**
 * Goals compete with the reserve for what is left each month (ADR-011): bills
 * first, then goals in priority order. A goal whose funding falls short shows
 * when it will actually get there.
 */
@Component({
  selector: 'app-goals-page',
  template: `
    <div class="page-head"><h1>Goals</h1></div>
    @for (g of goals(); track g.id) {
      <section class="card goal">
        <div class="line"><strong>{{ g.name }}</strong><span>{{ formatMoney(g.targetAmount) }}</span></div>
        <div class="meter" role="meter" [attr.aria-valuenow]="g.percent" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="g.name + ' saved'">
          <div class="fill" [class.behind]="g.slipping" [style.width.%]="g.percent"></div>
        </div>
        <div class="line muted"><span>{{ formatMoney(g.savedAmount) }} saved</span><span>by {{ formatDate(g.targetDate) }}</span></div>
        @if (g.required) {
          <p class="plan">This month: {{ formatMoney(g.funded ?? zero) }} of {{ formatMoney(g.required) }} needed.</p>
        }
        <p class="status" [class.bad]="g.slipping">
          <span aria-hidden="true">{{ g.slipping ? '⚠' : '✓' }}</span>
          {{ g.verdict }}
        </p>
      </section>
    } @empty {
      <p class="muted">No goals yet.</p>
    }
  `,
  styles: `
    .goal { display: grid; gap: 0.4rem; }
    .line { display: flex; justify-content: space-between; gap: 1rem; font-variant-numeric: tabular-nums; }
    .meter { height: 0.5rem; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: var(--accent); border-radius: 999px; }
    .fill.behind { background: var(--warn); }
    .plan, .status { margin: 0; font-size: 0.9rem; }
    .status { color: var(--ok); }
    .status.bad { color: var(--bad); }
  `,
})
export class GoalsPage {
  private readonly forecast = inject(ForecastService);
  private readonly household = inject(Household);

  protected readonly goals = computed(() => {
    const result = this.forecast.result().forecast;
    const first = result?.months[0];
    return this.household.goals().map((g) => {
      const month = first?.goals.find((x) => x.goalId === g.id);
      const completion = result?.goals.find((x) => x.goalId === g.id)?.projectedCompletion ?? null;
      const targetMonth = monthOf(g.targetDate);
      const slipping = completion === null || completion > targetMonth;
      // A bar width, not an amount — the one place a float of Money is harmless (ADR-012).
      const percent = Math.min(100, Math.round((Number(g.savedAmount) / Number(g.targetAmount)) * 100));
      const verdict =
        completion === null
          ? 'Not reached within the next 18 months at the current pace.'
          : slipping
            ? `Reaches the target in ${formatMonth(completion, 'long')} — after the target date.`
            : `On track — reaches the target in ${formatMonth(completion, 'long')}.`;
      return { ...g, percent, required: month?.required === '0.00' ? null : month?.required, funded: month?.funded, slipping, verdict };
    });
  });

  protected readonly zero = '0.00' as Money;
  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
}
