import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { BalanceSnapshot, CivilDate, Goal, Money } from '@home-mgmt/shared';
import { cashflow, sinkingFund, SnapshotError, type Forecast, type SinkingFund } from '@home-mgmt/core';
import { Household } from '../data/household';
import { today } from '../format';
import { forecastItems, type ForecastOccurrence } from './forecast-items';

const ZERO = '0.00' as Money;

/**
 * The engine, run on the phone over the local read model — the same code the
 * Mac runs (ADR-009), so the numbers agree once everything is synced. Works
 * with the Mac off.
 */
@Injectable({ providedIn: 'root' })
export class ForecastService {
  private readonly household = inject(Household);

  /** Re-evaluated every minute, so "today" rolls over at midnight without a reload. */
  readonly today = signal<CivilDate>(today());

  constructor() {
    const timer = setInterval(() => this.today.set(today()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  readonly items = computed<ForecastOccurrence[]>(() =>
    forecastItems({
      flowRows: this.household.allFlowRows(),
      flows: this.household.flows(),
      occurrences: this.household.occurrences(),
      pendingFlowIds: this.household.pendingFlowIds(),
      today: this.today(),
    }),
  );

  /** The anchor the engine starts from. Without a snapshot the forecast starts at zero — and says so. */
  readonly anchor = computed<BalanceSnapshot>(() => {
    const s = this.household.snapshot();
    return s ? { asOf: s.asOf, balance: s.balance, reservedAmount: s.reservedAmount } : { asOf: this.today(), balance: ZERO, reservedAmount: ZERO };
  });

  readonly hasSnapshot = computed(() => this.household.snapshot() !== null);

  private readonly goals = computed<Goal[]>(() => this.household.goals().map(({ version: _v, deletedAt: _d, ...g }) => g));

  readonly reserve = computed<SinkingFund>(() => sinkingFund(this.items(), this.today(), this.anchor().reservedAmount));

  readonly result = computed<{ forecast: Forecast; error: null } | { forecast: null; error: string }>(() => {
    try {
      return { forecast: cashflow(this.items(), this.anchor(), this.goals(), this.today(), 18), error: null };
    } catch (e) {
      if (e instanceof SnapshotError) return { forecast: null, error: e.message };
      throw e;
    }
  });

  /** Months where money not earmarked for bills or goals goes below zero — the spikes. */
  readonly tightMonths = computed(() => (this.result().forecast?.months ?? []).filter((m) => m.free.startsWith('-')));
}
