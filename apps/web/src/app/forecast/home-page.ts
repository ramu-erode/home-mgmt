import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { addMonths, dayInMonth, monthOf } from '@home-mgmt/core';
import { Household } from '../data/household';
import { formatDay, formatMoney, formatMonth } from '../format';
import { InstallCard } from '../shell/install-card';
import { ForecastService } from './forecast.service';

/**
 * The home screen leads with the one number (v1 definition of done): what to
 * set aside this month. Then whether a month ahead is tight, and what is due
 * soon.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, InstallCard],
  template: `
    <section class="hero card">
      <span class="label">Set aside this month</span>
      <span class="figure">{{ formatMoney(forecast.reserve().thisMonth) }}</span>
      <span class="sub">
        Settles to <strong>{{ formatMoney(forecast.reserve().steadyState) }}</strong> a month once caught up.
        <a routerLink="/reserve">Why</a>
      </span>
    </section>

    <app-install-card />

    @if (!forecast.hasSnapshot()) {
      <p class="hint">No balance entered yet — the forecast starts from ₹0, and assumes nothing is already set aside.</p>
    }

    @if (forecast.tightMonths().length) {
      <a class="card alert" routerLink="/cashflow">
        <span class="icon" aria-hidden="true">⚠</span>
        <span>
          <strong>{{ forecast.tightMonths().length === 1 ? 'A tight month ahead' : forecast.tightMonths().length + ' tight months ahead' }}</strong>
          — first {{ formatMonth(forecast.tightMonths()[0].month, 'long') }}, short by {{ formatMoney($any(forecast.tightMonths()[0].free.slice(1))) }}.
        </span>
      </a>
    } @else if (forecast.result().forecast) {
      <p class="card ok"><span aria-hidden="true">✓</span> No tight months in the next 18.</p>
    }

    <section class="card">
      <div class="head"><h2>Due in the next month</h2><a routerLink="/month">This month</a></div>
      @for (i of soon(); track i.id) {
        <div class="soon">
          <span class="date">{{ formatDay(i.dueDate) }}</span>
          <span class="name">{{ household.flowName(i.flowId) }}</span>
          <span class="amount">{{ i.direction === 'IN' ? '+' : '' }}{{ formatMoney(i.amount) }}</span>
        </div>
      } @empty {
        <p class="muted">Nothing due.</p>
      }
    </section>
  `,
  styles: `
    .hero { display: grid; gap: 0.25rem; padding: 1.25rem 1rem; }
    .label { color: var(--muted); font-size: 0.95rem; }
    /* The one hero figure: same sans, proportional digits. */
    .figure { font-size: 3rem; font-weight: 650; line-height: 1.1; letter-spacing: -0.01em; }
    .sub { color: var(--muted); font-size: 0.9rem; }
    .alert { display: flex; gap: 0.6rem; text-decoration: none; color: var(--text); border-color: var(--critical); }
    .alert .icon { color: var(--critical); font-size: 1.1rem; }
    .ok { color: var(--ok); }
    .head { display: flex; justify-content: space-between; align-items: baseline; }
    .head h2 { margin: 0 0 0.5rem; }
    .soon { display: grid; grid-template-columns: 3.6rem minmax(0, 1fr) auto; gap: 0.6rem; padding: 0.35rem 0; border-top: 1px solid var(--line); }
    .date { color: var(--muted); font-size: 0.85rem; }
    .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
  `,
})
export class HomePage {
  protected readonly forecast = inject(ForecastService);
  protected readonly household = inject(Household);

  /** From today up to the same day next month, skipping what is already paid or skipped. */
  protected readonly soon = computed(() => {
    const t = this.forecast.today();
    const until = dayInMonth(addMonths(monthOf(t), 1), Number(t.slice(8, 10)));
    return this.forecast.items().filter((i) => i.dueDate >= t && i.dueDate <= until && i.status !== 'SKIPPED' && i.status !== 'SETTLED');
  });

  protected readonly formatDay = formatDay;
  protected readonly formatMoney = formatMoney;
  protected readonly formatMonth = formatMonth;
}
