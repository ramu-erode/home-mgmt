import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Money, YearMonth } from '@home-mgmt/shared';
import { addMonths, addMoney, monthOf, split, subtractMoney } from '@home-mgmt/core';
import { Household } from '../data/household';
import { formatCompact, formatDate, formatDay, formatMoney, formatMonth, ordinal } from '../format';
import type { ForecastOccurrence } from './forecast-items';
import { ForecastService } from './forecast.service';
import { OccurrenceActions } from './occurrence-actions';

interface Line {
  item: ForecastOccurrence;
  name: string;
  /** Outgoings so far this month, including this one. */
  running: Money;
}

const STATUS_LABEL = { PLANNED: 'Planned', CONFIRMED: 'Confirmed', SETTLED: 'Paid', SKIPPED: 'Skipped' } as const;

/**
 * One month: what is due, a running total, who it is for, and — as a grid —
 * where in the month it lands. Tap an occurrence to act on it.
 */
@Component({
  selector: 'app-month-page',
  imports: [RouterLink, OccurrenceActions],
  templateUrl: './month-page.html',
  styleUrl: './month-page.css',
})
export class MonthPage {
  /** Route parameter 'YYYY-MM'; absent means the current month. */
  readonly ym = input<string | undefined>();

  private readonly household = inject(Household);
  private readonly forecast = inject(ForecastService);

  protected readonly view = signal<'list' | 'calendar'>('list');
  protected readonly open = signal<string | null>(null);
  protected readonly day = signal<string | null>(null);

  protected readonly month = computed<YearMonth>(() => {
    const m = this.ym();
    return (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : monthOf(this.forecast.today())) as YearMonth;
  });
  protected readonly prev = computed(() => addMonths(this.month(), -1));
  protected readonly next = computed(() => addMonths(this.month(), 1));

  private readonly inMonth = computed(() => this.forecast.items().filter((i) => monthOf(i.dueDate) === this.month()));

  protected readonly lines = computed<Line[]>(() => {
    let running = '0.00' as Money;
    return this.inMonth()
      .filter((i) => !this.day() || i.dueDate === this.day())
      .map((item) => {
        if (item.direction === 'OUT' && item.status !== 'SKIPPED') running = addMoney(running, item.amount);
        return { item, name: this.household.flowName(item.flowId), running };
      });
  });

  protected readonly totals = computed(() => {
    const counted = this.inMonth().filter((i) => i.status !== 'SKIPPED');
    const out = counted.filter((i) => i.direction === 'OUT').reduce((s, i) => addMoney(s, i.amount), '0.00' as Money);
    const inc = counted.filter((i) => i.direction === 'IN').reduce((s, i) => addMoney(s, i.amount), '0.00' as Money);
    return { out, in: inc, net: subtractMoney(inc, out) };
  });

  /**
   * Outgoings by person, split by each flow's weights with the engine's
   * largest-remainder rule; unallocated flows land in Household (ADR-010). The
   * rows always sum to the month's outgoings.
   */
  protected readonly byMember = computed(() => {
    const allocations = new Map(this.household.flows().map((f) => [f.flow.id, f.allocations.map((a) => ({ memberId: a.memberId, weight: a.weight }))]));
    const totals = new Map<string | null, Money>();
    for (const i of this.inMonth()) {
      if (i.direction !== 'OUT' || i.status === 'SKIPPED') continue;
      for (const share of split(i.amount, allocations.get(i.flowId) ?? [])) {
        totals.set(share.memberId, addMoney(totals.get(share.memberId) ?? ('0.00' as Money), share.amount));
      }
    }
    const members = this.household.members();
    const rows = members.filter((m) => totals.has(m.id)).map((m) => ({ name: m.name, amount: totals.get(m.id) as Money }));
    const unknown = [...totals.keys()].filter((k) => k !== null && !members.some((m) => m.id === k));
    for (const k of unknown) rows.push({ name: 'Removed member', amount: totals.get(k) as Money });
    if (totals.has(null)) rows.push({ name: 'Household', amount: totals.get(null) as Money });
    return rows;
  });

  /** Monday-first grid; blanks pad the first week. */
  protected readonly calendar = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const cells: ({ date: string; day: number; out: Money | null; count: number } | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= days; d++) {
      const date = `${this.month()}-${String(d).padStart(2, '0')}`;
      const due = this.inMonth().filter((i) => i.dueDate === date && i.status !== 'SKIPPED');
      const out = due.filter((i) => i.direction === 'OUT').reduce((s, i) => addMoney(s, i.amount), '0.00' as Money);
      cells.push({ date, day: d, out: out === '0.00' ? null : out, count: due.length });
    }
    return cells;
  });

  protected readonly hasPreview = computed(() => this.inMonth().some((i) => i.preview));

  protected toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  protected pickDay(date: string): void {
    this.day.set(this.day() === date ? null : date);
    this.view.set('list');
  }

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
  protected readonly formatMonth = formatMonth;
  protected readonly formatCompact = formatCompact;
  protected readonly formatDay = formatDay;
  protected readonly ordinal = ordinal;
}
