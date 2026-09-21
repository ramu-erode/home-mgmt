import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Household } from '../data/household';
import { formatDate, formatMoney, today } from '../format';
import { currentAmount, preview, recurrenceSummary, toDomain, type FlowView } from './flow-model';

interface Card {
  view: FlowView;
  summary: string;
  amount: string;
  next: string | null;
  who: string;
  category: string | null;
}

@Component({
  selector: 'app-flow-list',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <h1>Flows</h1>
      <a routerLink="/flows/new" class="button primary">Add</a>
    </div>

    @for (group of groups(); track group.title) {
      <section>
        <h2>{{ group.title }}</h2>
        @for (c of group.cards; track c.view.flow.id) {
          <a class="card flow" [routerLink]="['/flows', c.view.flow.id]">
            <div class="line">
              <strong>{{ c.view.flow.name }}</strong>
              <span class="amount">{{ c.amount }}</span>
            </div>
            <div class="muted">{{ c.summary }}</div>
            @if (c.next) { <div class="next">Next: {{ c.next }}</div> }
            <div class="chips">
              <span class="chip">{{ c.who }}</span>
              @if (c.category) { <span class="chip category">{{ c.category }}</span> }
            </div>
          </a>
        } @empty {
          <p class="muted">{{ group.empty }}</p>
        }
      </section>
    }
  `,
  styles: `
    .flow { display: grid; gap: 0.3rem; text-decoration: none; color: inherit; }
    .line { display: flex; justify-content: space-between; gap: 1rem; }
    .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .next { font-size: 0.85rem; }
  `,
})
export class FlowList {
  private readonly household = inject(Household);

  /** Names in household order, not the order the allocations were added. */
  private who(view: FlowView): string {
    if (view.allocations.length === 0) return 'Household';
    const ids = new Set(view.allocations.map((a) => a.memberId));
    return this.household.members().filter((m) => ids.has(m.id)).map((m) => m.name).join(', ') || 'Unknown';
  }

  protected readonly groups = computed(() => {
    const from = today();
    const card = (view: FlowView): Card => {
      const amount = currentAmount(view, from);
      // A one-off's summary already says when; repeating it as "next" is noise.
      const next = view.flow.recurrenceKind === 'ONE_OFF' ? undefined : preview(toDomain(view), from, 1).dates[0];
      return {
        view,
        summary: recurrenceSummary(view.flow),
        amount: amount ? formatMoney(amount) : '—',
        next: next ? formatDate(next.date) : null,
        who: this.who(view),
        category: this.household.categoryName(view.flow.categoryId),
      };
    };
    const flows = this.household.flows();
    return [
      { title: 'Outgoing', empty: 'Nothing yet — add the first recurring bill.', cards: flows.filter((f) => f.flow.direction === 'OUT').map(card) },
      { title: 'Income', empty: 'No income yet.', cards: flows.filter((f) => f.flow.direction === 'IN').map(card) },
    ];
  });
}
