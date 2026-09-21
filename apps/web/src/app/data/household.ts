import { computed, inject, Injectable } from '@angular/core';
import { isLive, type CategoryRow, type DeviceRow } from './rows';
import { liveSignal } from './live-signal';
import { LOCAL_DB } from './sync.service';
import type { FlowView } from '../flows/flow-model';

export interface CategoryNode {
  category: CategoryRow;
  children: CategoryRow[];
}

/**
 * Live, read-only views of the local household for the screens. Everything
 * here is a signal over IndexedDB (ADR-006); writes go through LocalStore.
 */
@Injectable({ providedIn: 'root' })
export class Household {
  private readonly db = inject(LOCAL_DB);

  readonly members = liveSignal(async () => (await this.db.member.toArray()).filter(isLive).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)), []);

  readonly categories = liveSignal(async () => (await this.db.category.toArray()).filter(isLive).sort((a, b) => a.name.localeCompare(b.name)), []);

  readonly categoryTree = computed<CategoryNode[]>(() => {
    const all = this.categories();
    return all.filter((c) => c.parentId === null).map((category) => ({ category, children: all.filter((c) => c.parentId === category.id) }));
  });

  readonly flows = liveSignal<FlowView[]>(async () => {
    const [flows, amounts, allocations] = await Promise.all([this.db.flow.toArray(), this.db.flowAmount.toArray(), this.db.flowAllocation.toArray()]);
    return flows
      .filter(isLive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((flow) => ({
        flow,
        amounts: amounts.filter((a) => a.flowId === flow.id && isLive(a)),
        allocations: allocations.filter((a) => a.flowId === flow.id && isLive(a)),
      }));
  }, []);

  /**
   * This phone's device row, once it exists locally. Read-only on purpose: a
   * live query may not write, so it must not mint the device id itself — it
   * reads the id, and re-runs when SyncService stores one.
   */
  readonly device = liveSignal<DeviceRow | null>(async () => {
    const id = (await this.db.meta.get('deviceId'))?.value;
    return id ? ((await this.db.device.get(id)) ?? null) : null;
  }, null);

  /** Set up means named and linked to a member — "New device" is the server's placeholder (ADR-014). */
  readonly deviceReady = computed(() => {
    const d = this.device();
    return !!d && d.deletedAt === null && d.name !== 'New device' && d.memberId !== null;
  });

  memberName(id: string | null): string {
    if (id === null) return 'Household';
    return this.members().find((m) => m.id === id)?.name ?? 'Unknown';
  }

  categoryName(id: string | null): string | null {
    if (id === null) return null;
    const all = this.categories();
    const c = all.find((x) => x.id === id);
    if (!c) return null;
    const parent = c.parentId ? all.find((x) => x.id === c.parentId) : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  }
}
