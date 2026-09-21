import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Uuid } from '@home-mgmt/shared';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import { formatDate, formatMoney, monthName, today } from '../format';
import { blankDraft, changes, draftFrom, duplicateFor, problems, toFlow, toRows, type Cadence, type FlowDraft } from './flow-draft';
import { preview } from './flow-model';

/**
 * Create or edit a flow: the rule, its amount schedule and its split
 * (ADR-003, ADR-010, ADR-013). The preview underneath runs the same engine the
 * Mac will, so what it shows is what will be materialised.
 */
@Component({
  selector: 'app-flow-editor',
  imports: [FormsModule, RouterLink],
  templateUrl: './flow-editor.html',
  styleUrl: './flow-editor.css',
})
export class FlowEditor {
  /** Route parameter: a flow id, or "new". */
  readonly id = input.required<string>();

  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);
  private readonly router = inject(Router);

  protected readonly draft = signal<FlowDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly duplicateMember = signal<Uuid | null>(null);
  protected readonly months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) }));
  protected readonly cadences: { value: Cadence; label: string }[] = [
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'YEARLY', label: 'Yearly' },
    { value: 'MONTHS', label: 'Set months' },
    { value: 'ONE_OFF', label: 'Once' },
  ];

  private readonly original = computed(() => this.household.flows().find((f) => f.flow.id === this.id()) ?? null);
  protected readonly missing = computed(() => this.id() !== 'new' && this.household.flows().length > 0 && !this.original());
  protected readonly problems = computed(() => {
    const d = this.draft();
    return d ? problems(d) : [];
  });
  protected readonly preview = computed(() => {
    const d = this.draft();
    if (!d || this.problems().length) return null;
    return preview(toFlow(d), today(), 6);
  });

  constructor() {
    // Initialise once the flow is available locally; later syncs must not
    // overwrite what the person is typing.
    effect(() => {
      const id = this.id();
      const original = this.original();
      untracked(() => {
        if (this.initialisedFor === id) return;
        if (id === 'new') this.draft.set(blankDraft(today()));
        else if (original) this.draft.set(draftFrom(original));
        else return; // not pulled yet — wait for it
        this.initialisedFor = id;
      });
    });
  }

  /** The route the draft was built for; a background sync never rebuilds it. */
  private initialisedFor: string | null = null;

  protected patch(change: Partial<FlowDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected toggleMonth(month: number): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month] });
  }

  protected addAmount(): void {
    const d = this.draft();
    if (!d) return;
    const last = d.amounts[d.amounts.length - 1];
    this.patch({ amounts: [...d.amounts, { id: crypto.randomUUID(), effectiveFrom: '', amountText: last?.amountText ?? '' }] });
  }

  protected updateAmount(index: number, change: { effectiveFrom?: string; amountText?: string }): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ amounts: d.amounts.map((a, i) => (i === index ? { ...a, ...change } : a)) });
  }

  protected removeAmount(index: number): void {
    const d = this.draft();
    if (d) this.patch({ amounts: d.amounts.filter((_, i) => i !== index) });
  }

  protected setSplit(split: 'household' | 'members'): void {
    this.patch({ split });
  }

  protected toggleMember(memberId: Uuid): void {
    const d = this.draft();
    if (!d) return;
    const present = d.allocations.some((a) => a.memberId === memberId);
    this.patch({
      allocations: present ? d.allocations.filter((a) => a.memberId !== memberId) : [...d.allocations, { id: crypto.randomUUID(), memberId, weight: 1 }],
    });
  }

  protected setWeight(memberId: Uuid, weight: number): void {
    const d = this.draft();
    if (d) this.patch({ allocations: d.allocations.map((a) => (a.memberId === memberId ? { ...a, weight } : a)) });
  }

  protected weightOf(memberId: Uuid): number | null {
    return this.draft()?.allocations.find((a) => a.memberId === memberId)?.weight ?? null;
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.problems().length) return;
    this.saving.set(true);
    try {
      const { writes, deletes } = changes(this.original(), toRows(d));
      await this.store.saveAll(writes, deletes);
      await this.router.navigate(['/flows']);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const d = this.draft();
    if (!d || d.isNew) return;
    const confirmed = confirm(`Delete "${d.name}"? Planned occurrences go with it; anything confirmed or settled is kept.`);
    if (!confirmed) return;
    await this.store.remove('flow', d.id);
    await this.router.navigate(['/flows']);
  }

  protected async duplicate(): Promise<void> {
    const original = this.original();
    const memberId = this.duplicateMember();
    if (!original || !memberId) return;
    const copy = duplicateFor(original, memberId, this.household.memberName(memberId));
    const { writes } = changes(null, toRows(copy));
    await this.store.saveAll(writes);
    this.duplicateMember.set(null);
    await this.router.navigate(['/flows', copy.id]);
  }

  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
}
