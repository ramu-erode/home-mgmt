import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Uuid } from '@home-mgmt/shared';
import { InvalidFlowError, project, reconcile, type ReconcilePlan } from '@home-mgmt/core';
import { DATABASE, inTransaction, type Database, type Tx } from '../db/database';
import { applyPlan, liveFlowIds, liveOccurrences, loadFlows } from '../db/occurrence-store';
import { HouseholdTime } from '../household-time';

export interface RegenerationReport {
  flows: number;
  inserted: number;
  updated: number;
  deleted: number;
  /** Flows whose rule could not be expanded (e.g. no amount in force yet); their occurrences are left untouched. */
  skipped: { flowId: Uuid; reason: string }[];
}

/**
 * The only writer of occurrence rows (ADR-009). Runs inside the caller's
 * transaction when a push changes a flow, and on its own for the horizon roll.
 */
@Injectable()
export class RegenerationService {
  private readonly log = new Logger(RegenerationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly time: HouseholdTime,
  ) {}

  /**
   * Regenerates the given flows. A tombstoned flow expands to nothing, so its
   * PLANNED, un-overridden occurrences are tombstoned; everything else of its
   * history stays (ADR-003).
   */
  async regenerate(tx: Tx, flowIds: Uuid[]): Promise<RegenerationReport> {
    const report: RegenerationReport = { flows: flowIds.length, inserted: 0, updated: 0, deleted: 0, skipped: [] };
    if (flowIds.length === 0) return report;

    const { from, to } = this.time.horizon();
    const flows = await loadFlows(tx, flowIds);
    const existing = await liveOccurrences(tx, flowIds);
    const live = new Set(flows.map((f) => f.id));

    for (const flowId of flowIds) {
      const flow = flows.filter((f) => f.id === flowId);
      try {
        const plan = reconcile({ flowIds: [flowId], from, to }, project(flow, from, to), existing);
        await applyPlan(tx, plan);
        tally(report, plan);
      } catch (e) {
        if (!(e instanceof InvalidFlowError) || !live.has(flowId)) throw e;
        report.skipped.push({ flowId, reason: e.message });
      }
    }
    return report;
  }

  /** Extends every live flow to the current horizon. Idempotent, so running it twice is harmless. */
  async rollHorizon(): Promise<RegenerationReport> {
    const ids = await liveFlowIds(this.db);
    const report = await inTransaction(this.db, (tx) => this.regenerate(tx, ids));
    this.log.log(`horizon roll: ${report.flows} flows, +${report.inserted} ~${report.updated} -${report.deleted}, ${report.skipped.length} skipped`);
    for (const s of report.skipped) this.log.warn(s.reason);
    return report;
  }
}

function tally(report: RegenerationReport, plan: ReconcilePlan): void {
  report.inserted += plan.insert.length;
  report.updated += plan.updateAmount.length;
  report.deleted += plan.softDelete.length;
}
