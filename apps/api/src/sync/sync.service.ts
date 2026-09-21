import { Inject, Injectable } from '@nestjs/common';
import type { CommandOperation, DeleteOperation, Operation, PushResponse, RejectionReason, UpsertOperation, Uuid } from '@home-mgmt/shared';
import { applyCommand, REJECTION_MESSAGES } from '@home-mgmt/core';
import { DATABASE, inTransaction, withSavepoint, type Database, type Tx } from '../db/database';
import { lockOccurrence, patchOccurrence } from '../db/occurrence-store';
import { cascadeFlowDelete, ensureDevice, findRow, pull, softDeleteLww, upsertLww, type PullResult } from '../db/sync-store';
import { RegenerationService } from '../regeneration/regeneration.service';
import { validateOperation } from './validation';

type Outcome = { ok: true; touchedFlows?: Uuid[] } | { ok: false; reason: RejectionReason; message: string };

const STALE = 'A newer change to this row already won.';
/** A phone whose clock runs ahead would otherwise win every conflict until its clock caught up. */
const MAX_CLOCK_LEAD_MS = 5 * 60 * 1000;

class Refusal extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Push and pull (ADR-009). A push is one transaction: each operation runs under
 * its own savepoint so a bad one is rejected without sinking the rest, then
 * every flow the push touched is regenerated before commit — occurrences and
 * the rule change become visible together.
 */
@Injectable()
export class SyncService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly regeneration: RegenerationService,
  ) {}

  pull(since: bigint): Promise<PullResult> {
    return pull(this.db, since);
  }

  async push(operations: unknown[], deviceId: Uuid): Promise<PushResponse> {
    const response: PushResponse = { applied: [], rejected: [] };
    await inTransaction(this.db, async (tx) => {
      await ensureDevice(tx, deviceId);
      const touched = new Set<Uuid>();
      for (const raw of operations) {
        const v = validateOperation(raw);
        if (!v.ok) {
          response.rejected.push({ id: v.id, reason: 'invalid', message: v.message });
          continue;
        }
        const outcome = await this.applyOne(tx, v.operation, deviceId);
        if (outcome.ok) {
          response.applied.push(v.operation.id);
          outcome.touchedFlows?.forEach((id) => touched.add(id));
        } else {
          response.rejected.push({ id: v.operation.id, reason: outcome.reason, message: outcome.message });
        }
      }
      await this.regeneration.regenerate(tx, [...touched]);
    });
    return response;
  }

  private async applyOne(tx: Tx, op: Operation, deviceId: Uuid): Promise<Outcome> {
    const clientUpdatedAt = clampClock(op.clientUpdatedAt);
    try {
      return await withSavepoint(tx, () => {
        if (op.op === 'command') return this.command(tx, op, clientUpdatedAt, deviceId);
        if (op.op === 'delete') return this.remove(tx, op, clientUpdatedAt, deviceId);
        return this.upsert(tx, op, clientUpdatedAt, deviceId);
      });
    } catch (e) {
      return { ok: false, reason: 'invalid', message: e instanceof Error ? e.message : String(e) };
    }
  }

  private async command(tx: Tx, op: CommandOperation, clientUpdatedAt: string, deviceId: Uuid): Promise<Outcome> {
    const state = await lockOccurrence(tx, op.occurrenceId);
    if (!state) return { ok: false, reason: 'gone', message: REJECTION_MESSAGES.gone };
    const result = applyCommand(state, op);
    if (!result.ok) return { ok: false, reason: result.reason, message: REJECTION_MESSAGES[result.reason] };
    await patchOccurrence(tx, op.occurrenceId, result.patch, clientUpdatedAt, deviceId);
    return { ok: true };
  }

  private async remove(tx: Tx, op: DeleteOperation, clientUpdatedAt: string, deviceId: Uuid): Promise<Outcome> {
    const before = op.table === 'flowAmount' ? await findRow(tx, 'flowAmount', op.payload.id) : undefined;
    if ((await softDeleteLww(tx, op.table, op.payload.id, clientUpdatedAt, deviceId)) === 'stale') return { ok: false, reason: 'stale', message: STALE };
    if (op.table === 'flow') {
      await cascadeFlowDelete(tx, op.payload.id, clientUpdatedAt, deviceId);
      return { ok: true, touchedFlows: [op.payload.id] };
    }
    return { ok: true, touchedFlows: before ? [before['flowId'] as Uuid] : [] };
  }

  private async upsert(tx: Tx, op: UpsertOperation, clientUpdatedAt: string, deviceId: Uuid): Promise<Outcome> {
    const before = await findRow(tx, op.table, op.payload.id);
    await this.checkReferences(tx, op, before);
    if ((await upsertLww(tx, op.table, op.payload, clientUpdatedAt, deviceId)) === 'stale') return { ok: false, reason: 'stale', message: STALE };
    return { ok: true, touchedFlows: touchedBy(op, before) };
  }

  /** Rules the schema cannot express. Throws a Refusal, reported as `invalid`. */
  private async checkReferences(tx: Tx, op: UpsertOperation, before: Record<string, unknown> | undefined): Promise<void> {
    if (op.table === 'flow' && before && before['direction'] !== op.payload['direction']) {
      throw new Refusal('A flow cannot change direction — its history would flip sign. Create a new flow.');
    }
    if (op.table === 'category' && op.payload['parentId']) {
      const parent = await findRow(tx, 'category', op.payload['parentId'] as Uuid);
      if (!parent || parent['deletedAt']) throw new Refusal('Parent category does not exist.');
      if (parent['parentId']) throw new Refusal('Categories are two levels deep; the parent is already a child.');
    }
  }
}

/** Flows whose occurrences an upsert can change: the flow itself, or an amount's flow (old and new, if it moved). */
function touchedBy(op: UpsertOperation, before: Record<string, unknown> | undefined): Uuid[] {
  if (op.table === 'flow') return [op.payload.id];
  if (op.table !== 'flowAmount') return [];
  const ids = [op.payload['flowId'] as Uuid];
  if (before && before['flowId'] !== op.payload['flowId']) ids.push(before['flowId'] as Uuid);
  return ids;
}

function clampClock(clientUpdatedAt: string): string {
  const limit = Date.now() + MAX_CLOCK_LEAD_MS;
  return Date.parse(clientUpdatedAt) > limit ? new Date().toISOString() : clientUpdatedAt;
}
