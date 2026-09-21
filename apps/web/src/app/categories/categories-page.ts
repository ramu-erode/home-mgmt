import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Uuid } from '@home-mgmt/shared';
import { Household } from '../data/household';
import { LocalStore } from '../data/local-store';
import type { CategoryRow } from '../data/rows';

/** Two-level roll-up categories; income sources live here too (ADR-010). */
@Component({
  selector: 'app-categories-page',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Categories</h1></div>
    @for (node of household.categoryTree(); track node.category.id) {
      <section class="card">
        <div class="row">
          <input class="grow strong" [ngModel]="node.category.name" (change)="rename(node.category, $any($event.target).value)" [name]="'c' + node.category.id" aria-label="Category name" />
          <button type="button" class="link danger-text" (click)="remove(node.category, node.children.length)">Remove</button>
        </div>
        @for (child of node.children; track child.id) {
          <div class="row child">
            <input class="grow" [ngModel]="child.name" (change)="rename(child, $any($event.target).value)" [name]="'c' + child.id" aria-label="Subcategory name" />
            <button type="button" class="link danger-text" (click)="remove(child, 0)">Remove</button>
          </div>
        }
        <div class="row child">
          <input class="grow" [ngModel]="childName()[node.category.id] ?? ''" (ngModelChange)="setChildName(node.category.id, $event)" [name]="'new' + node.category.id" placeholder="Add a subcategory" autocomplete="off" (keydown.enter)="add(node.category.id)" />
          <button type="button" (click)="add(node.category.id)">Add</button>
        </div>
      </section>
    } @empty {
      <p class="muted">No categories yet.</p>
    }
    <section class="card">
      <div class="row">
        <input class="grow" [(ngModel)]="topName" name="top" placeholder="Add a category" autocomplete="off" (keydown.enter)="add(null)" />
        <button type="button" (click)="add(null)" [disabled]="!topName().trim()">Add</button>
      </div>
    </section>
  `,
  styles: `.child { margin: 0.5rem 0 0 1rem; } .grow { flex: 1; } .strong { font-weight: 600; }`,
})
export class CategoriesPage {
  protected readonly household = inject(Household);
  private readonly store = inject(LocalStore);
  protected readonly topName = signal('');
  protected readonly childName = signal<Record<string, string>>({});

  protected setChildName(parentId: Uuid, name: string): void {
    this.childName.update((m) => ({ ...m, [parentId]: name }));
  }

  protected async add(parentId: Uuid | null): Promise<void> {
    const name = (parentId ? this.childName()[parentId] ?? '' : this.topName()).trim();
    if (!name) return;
    await this.store.save('category', { id: crypto.randomUUID(), name, parentId });
    if (parentId) this.setChildName(parentId, '');
    else this.topName.set('');
  }

  protected async rename(c: CategoryRow, name: string): Promise<void> {
    if (name.trim() && name.trim() !== c.name) await this.store.save('category', { id: c.id, name: name.trim(), parentId: c.parentId });
  }

  protected async remove(c: CategoryRow, children: number): Promise<void> {
    if (children > 0) {
      alert(`Remove the ${children} subcategories under ${c.name} first.`);
      return;
    }
    if (confirm(`Remove ${c.name}? Flows in it keep working, uncategorised.`)) await this.store.remove('category', c.id);
  }
}
