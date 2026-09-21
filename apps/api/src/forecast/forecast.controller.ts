import { BadRequestException, Controller, Get, Inject, Query, UnprocessableEntityException } from '@nestjs/common';
import type { BalanceSnapshot, CivilDate, Money } from '@home-mgmt/shared';
import { addMonths, cashflow, formatDate, monthOf, sinkingFund, SnapshotError, type Forecast, type SinkingFund } from '@home-mgmt/core';
import { DATABASE, type Database } from '../db/database';
import { forecastInputs } from '../db/occurrence-store';
import { HouseholdTime } from '../household-time';

export interface ForecastResponse {
  today: CivilDate;
  /** Null until a balance snapshot has been entered; the forecast then starts from zero. */
  snapshot: BalanceSnapshot | null;
  sinkingFund: SinkingFund;
  forecast: Forecast;
}

/** Enough history for every flow's previous occurrence to open the next accrual window (ADR-011). */
const HISTORY_MONTHS = 13;

/**
 * The engine, run on the server's materialised occurrences. Phones will run the
 * same engine locally (ADR-009); this endpoint is for the Phase 2 check and for
 * anything that wants the server's view.
 */
@Controller('forecast')
export class ForecastController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly time: HouseholdTime,
  ) {}

  @Get()
  async get(@Query('months') months = '18'): Promise<ForecastResponse> {
    const horizon = Number(months);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 36) throw new BadRequestException('months must be 1–36');

    const today = this.time.today();
    const [y, m] = addMonths(monthOf(today), -HISTORY_MONTHS).split('-').map(Number);
    const { items, snapshot, goals } = await forecastInputs(this.db, formatDate(y, m, 1));
    const anchor = snapshot ?? { asOf: today, balance: '0.00' as Money, reservedAmount: '0.00' as Money };

    try {
      return {
        today,
        snapshot,
        sinkingFund: sinkingFund(items, today, anchor.reservedAmount),
        forecast: cashflow(items, anchor, goals, today, horizon),
      };
    } catch (e) {
      if (e instanceof SnapshotError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }
}
