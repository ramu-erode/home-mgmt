import { Inject, Injectable } from '@nestjs/common';
import { civilDate, type CivilDate } from '@home-mgmt/shared';
import { addMonths, dayInMonth, formatDate, monthOf } from '@home-mgmt/core';
import { CONFIG, type AppConfig } from './config';

/**
 * The one place the API reads the clock. The engine never does (ADR-013); it
 * is handed `today` from here.
 */
@Injectable()
export class HouseholdTime {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  today(): CivilDate {
    if (this.config.fixedToday) return civilDate(this.config.fixedToday);
    return todayIn(this.config.householdTimeZone, new Date());
  }

  /**
   * What is materialised: from the first of this month to the end of the
   * seventeenth month after it — 18 months (ADR-003).
   */
  horizon(months = 18): { from: CivilDate; to: CivilDate } {
    const first = monthOf(this.today());
    const [y, m] = first.split('-').map(Number);
    return { from: formatDate(y, m, 1), to: dayInMonth(addMonths(first, months - 1), 31) };
  }
}

/** The calendar day at `instant` in `timeZone`. `en-CA` formats as YYYY-MM-DD. */
export function todayIn(timeZone: string, instant: Date): CivilDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  return civilDate(parts);
}
