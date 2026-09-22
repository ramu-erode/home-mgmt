import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { Uuid } from '@home-mgmt/shared';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import { today } from '../format';
import { paymentProblems, paymentWrites, type PaymentInput } from './entry-model';

/**
 * Quick-add for an expected contracting payment (ADR-010): a one-off income
 * flow, counted in "all income" until it is confirmed from the month view.
 */
@Component({
  selector: 'app-payment-page',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Expected payment</h1></div>
    <section class="card form">
      <label>From <input [ngModel]="input().client" (ngModelChange)="patch({ client: $event })" name="client" placeholder="e.g. Client X" autocomplete="off" /></label>
      <div class="pair">
        <label>Amount <input inputmode="decimal" [ngModel]="input().amountText" (ngModelChange)="patch({ amountText: $event })" name="amount" placeholder="0.00" autocomplete="off" /></label>
        <label>Expected <input type="date" [ngModel]="input().expected" (ngModelChange)="patch({ expected: $event })" name="expected" /></label>
      </div>
      <label>
        Whose income
        <select [ngModel]="input().memberId" (ngModelChange)="patch({ memberId: $event })" name="member">
          <option [ngValue]="null">Household</option>
          @for (m of household.members(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
        </select>
      </label>
      <label>
        Category
        <select [ngModel]="input().categoryId" (ngModelChange)="patch({ categoryId: $event })" name="category">
          <option [ngValue]="null">None</option>
          @for (node of household.categoryTree(); track node.category.id) {
            <option [ngValue]="node.category.id">{{ node.category.name }}</option>
            @for (child of node.children; track child.id) {
              <option [ngValue]="child.id">&nbsp;&nbsp;{{ node.category.name }} › {{ child.name }}</option>
            }
          }
        </select>
      </label>
      @if (touched() && problems().length) {
        <ul class="problems">@for (p of problems(); track p) { <li>{{ p }}</li> }</ul>
      }
      <button type="button" class="primary" (click)="save()" [disabled]="problems().length > 0">Add</button>
      <p class="hint">It counts in "all income" straight away, and in the confirmed-only line once you confirm it from the month view.</p>
    </section>
  `,
  styles: `
    .form { display: grid; gap: 0.75rem; }
    .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .problems { color: var(--bad); margin: 0; padding-left: 1.1rem; }
  `,
})
export class PaymentPage {
  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);
  private readonly router = inject(Router);

  /** Defaults to a "Contracting" category if the household has one. */
  private readonly defaultCategory = computed<Uuid | null>(() => this.household.categories().find((c) => /contract/i.test(c.name))?.id ?? null);
  protected readonly input = signal<PaymentInput>({ client: '', amountText: '', expected: today(), categoryId: null, memberId: null });
  protected readonly touched = signal(false);
  protected readonly problems = computed(() => paymentProblems(this.input()));
  private categoryChosen = false;

  protected patch(change: Partial<PaymentInput>): void {
    if ('categoryId' in change) this.categoryChosen = true;
    this.touched.set(true);
    this.input.update((i) => ({ ...i, ...change }));
  }

  protected async save(): Promise<void> {
    this.touched.set(true);
    if (this.problems().length) return;
    const input = this.categoryChosen ? this.input() : { ...this.input(), categoryId: this.input().categoryId ?? this.defaultCategory() };
    await this.store.saveAll(paymentWrites(input, { flow: crypto.randomUUID(), amount: crypto.randomUUID(), allocation: crypto.randomUUID() }));
    await this.router.navigate(['/flows']);
  }
}
