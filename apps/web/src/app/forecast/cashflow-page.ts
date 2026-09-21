import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Money } from '@home-mgmt/shared';
import type { MonthPosition } from '@home-mgmt/core';
import { formatCompact, formatMoney, formatMonth, isNegative } from '../format';
import { columnPath, labelsFit, linear, linePath, niceTicks } from './chart-geometry';
import { ForecastService } from './forecast.service';

/** One viewBox for both charts so their month columns line up under one crosshair. */
const W = 400;
const LEFT = 46;
const RIGHT = 70;
const PLOT = W - LEFT - RIGHT;

interface Series {
  key: 'balanceAll' | 'balanceConfirmed' | 'free';
  label: string;
  /** CSS custom property carrying the validated series colour. */
  color: string;
}

/**
 * Balance lines in categorical slots 1–3 (validated in both modes, see the
 * palette note in styles). Same unit, so one axis — outgoings are a different
 * measure and get their own chart above, never a second y-scale.
 */
const SERIES: Series[] = [
  { key: 'balanceAll', label: 'Balance', color: 'var(--series-1)' },
  { key: 'balanceConfirmed', label: 'Confirmed income only', color: 'var(--series-2)' },
  { key: 'free', label: 'Free after bills & goals', color: 'var(--series-3)' },
];

/**
 * The 18-month cashflow (Phase 4): money out each month — where the spikes
 * are — and the running balance under three readings. A crosshair reads every
 * series at a month; the table carries every value without hovering.
 */
@Component({
  selector: 'app-cashflow-page',
  imports: [RouterLink],
  templateUrl: './cashflow-page.html',
  styleUrl: './cashflow-page.css',
})
export class CashflowPage {
  protected readonly forecast = inject(ForecastService);
  protected readonly hover = signal<number | null>(null);
  protected readonly showTable = signal(false);

  protected readonly W = W;
  protected readonly LEFT = LEFT;
  protected readonly PLOT = PLOT;
  protected readonly series = SERIES;

  protected readonly months = computed<MonthPosition[]>(() => this.forecast.result().forecast?.months ?? []);
  private readonly band = computed(() => PLOT / Math.max(1, this.months().length));
  protected readonly cx = (i: number) => LEFT + this.band() * (i + 0.5);

  /** Every third month, so labels never collide at phone width. */
  protected readonly xLabels = computed(() =>
    this.months()
      .map((m, i) => ({ i, text: formatMonth(m.month).replace(/ (\d\d)(\d\d)$/, ' ’$2') }))
      .filter(({ i }) => i % 3 === 0),
  );

  // ---- Chart 1: money out each month ------------------------------------------------
  protected readonly outH = 150;
  private readonly outTop = 18;
  private readonly outBase = 124;
  protected readonly outTicks = computed(() => niceTicks(0, Math.max(0, ...this.months().map((m) => Number(m.outgoings))), 3));
  private readonly outY = computed(() => {
    const t = this.outTicks();
    return linear(0, t[t.length - 1], this.outBase, this.outTop);
  });
  protected readonly outTickY = (v: number) => this.outY()(v);
  protected readonly columns = computed(() => {
    const width = Math.min(24, this.band() - 4);
    const values = this.months().map((m) => Number(m.outgoings));
    // Label one column only — the first peak. The rest live in the readout and the table.
    const peak = values.indexOf(Math.max(...values));
    return this.months().map((m, i) => {
      const top = this.outY()(values[i]);
      return { i, d: columnPath(this.cx(i) - width / 2, width, top, this.outBase), top, isMax: i === peak && values[i] > 0, value: m.outgoings };
    });
  });
  protected readonly outBaseY = this.outBase;

  // ---- Chart 2: balance ------------------------------------------------------------
  protected readonly balH = 200;
  private readonly balTop = 12;
  private readonly balBase = 176;
  protected readonly balTicks = computed(() => {
    const values = this.months().flatMap((m) => SERIES.map((s) => Number(m[s.key])));
    return niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  });
  private readonly balY = computed(() => {
    const t = this.balTicks();
    return linear(t[0], t[t.length - 1], this.balBase, this.balTop);
  });
  protected readonly balTickY = (v: number) => this.balY()(v);
  protected readonly zeroY = computed(() => this.balY()(0));
  protected readonly lines = computed(() =>
    SERIES.map((s) => {
      const pts = this.months().map((m, i) => [this.cx(i), this.balY()(Number(m[s.key]))] as [number, number]);
      const last = pts[pts.length - 1];
      return { ...s, d: linePath(pts), end: last, endValue: this.months()[this.months().length - 1]?.[s.key] as Money | undefined };
    }),
  );
  /** Direct end labels only when they do not collide — otherwise the legend alone carries identity. */
  protected readonly endLabels = computed(() => labelsFit(this.lines().map((l) => l.end?.[1] ?? 0), 12));

  // ---- Hover / focus -----------------------------------------------------------------
  protected readonly hovered = computed(() => {
    const i = this.hover();
    return i === null ? null : (this.months()[i] ?? null);
  });
  protected pointer(event: PointerEvent): void {
    const svg = event.currentTarget as SVGElement;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * W;
    const i = Math.floor((x - LEFT) / this.band());
    this.hover.set(i >= 0 && i < this.months().length ? i : null);
  }

  protected key(event: KeyboardEvent): void {
    const n = this.months().length;
    if (!n) return;
    const i = this.hover() ?? 0;
    if (event.key === 'ArrowRight') this.hover.set(Math.min(n - 1, i + 1));
    else if (event.key === 'ArrowLeft') this.hover.set(Math.max(0, i - 1));
    else if (event.key === 'Escape') this.hover.set(null);
    else return;
    event.preventDefault();
  }

  protected readonly formatMoney = formatMoney;
  protected readonly formatCompact = formatCompact;
  protected readonly formatMonth = formatMonth;
  protected readonly isNegative = isNegative;
}
