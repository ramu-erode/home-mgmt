import { Route } from '@angular/router';
import { CategoriesPage } from './categories/categories-page';
import { FlowEditor } from './flows/flow-editor';
import { FlowList } from './flows/flow-list';
import { MembersPage } from './members/members-page';

/**
 * Eagerly loaded, every one: a lazy route never visited would not exist
 * offline (ADR-006).
 */
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'flows' },
  { path: 'flows', component: FlowList, title: 'Flows' },
  { path: 'flows/:id', component: FlowEditor, title: 'Flow' },
  { path: 'members', component: MembersPage, title: 'Members' },
  { path: 'categories', component: CategoriesPage, title: 'Categories' },
  { path: '**', redirectTo: 'flows' },
];
