import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Household } from '../data/household';
import { formatDate, formatMoney, formatMonth } from '../format';
import { ForecastService } from './forecast.service';

/**
 * How the monthly reserve is worked out (ADR-011): each bill accrues over its
 * own window, the existing reserve covers the nearest first, and every
 * contribution is rounded up to the rupee.
 */
@Component({
  selector: 'app-reserve-page',
  imports: [RouterLink],
  template: `
    <div class="page-head"><h1>Reserve</h1></div>

    <div class="tiles">
      <div class="tile"><span class="label">This month</span><span class="value">{{ formatMoney(r().thisMonth) }}</span></div>
      <div class="tile"><span class="label">Steady state</span><span class="value">{{ formatMoney(r().steadyState) }}</span></div>
      <a class="tile" routerLink="/balance"><span class="label">Already set aside</span><span class="value">{{ formatMoney(forecast.anchor().reservedAmount) }}</span></a>
    </div>
    <p class="hint">
      "This month" includes catching up on bills nothing has been saved for yet; it falls towards the steady state month by month.
      @if (r().unusedReserve !== '0.00') { {{ formatMoney(r().unusedReserve) }} of what is set aside is not needed by anything in the next 18 months. }
    </p>

    <section class="card">
      <h2>By month</h2>
      <table>
        <tbody>
          @for (m of byMonth(); track m.month) {
            <tr><th scope="row">{{ formatMonth(m.month) }}</th><td>{{ formatMoney(m.amount) }}</td></tr>
          }
        </tbody>
      </table>
    </section>

    <section class="card table-wrap">
      <h2>By bill</h2>
      <table>
        <thead><tr><th scope="col">Bill</th><th scope="col">Due</th><th scope="col">Amount</th><th scope="col">Covered</th><th scope="col">Per month</th></tr></thead>
        <tbody>
          @for (a of r().perOccurrence; track a.flowId + a.dueDate) {
            <tr>
              <th scope="row">{{ household.flowName(a.flowId) }}</th>
              <td>{{ formatDate(a.dueDate) }}</td>
              <td>{{ formatMoney(a.amount) }}</td>
              <td>{{ a.covered === '0.00' ? '—' : formatMoney(a.covered) }}</td>
              <td>{{ formatMoney(a.monthly) }} × {{ a.months }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; margin-bottom: 0.5rem; }
    .tile { text-decoration: none; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.6rem 0.7rem; display: grid; }
    .tile .label { font-size: 0.78rem; color: var(--muted); }
    .tile .value { font-weight: 600; overflow-wrap: anywhere; }
    .hint { margin-bottom: 0.75rem; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
    th, td { padding: 0.3rem 0.4rem; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    th:first-child { text-align: left; font-weight: 400; white-space: normal; }
    thead th { color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--line); }
  `,
})
export class ReservePage {
  protected readonly forecast = inject(ForecastService);
  protected readonly household = inject(Household);
  protected readonly r = this.forecast.reserve;
  protected readonly byMonth = computed(() => this.r().byMonth.slice(0, 12));

  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
  protected readonly formatMonth = formatMonth;
}
