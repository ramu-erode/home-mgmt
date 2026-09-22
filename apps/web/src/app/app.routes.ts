import { Route } from '@angular/router';
import { CategoriesPage } from './categories/categories-page';
import { FlowEditor } from './flows/flow-editor';
import { FlowList } from './flows/flow-list';
import { CashflowPage } from './forecast/cashflow-page';
import { GoalsPage } from './forecast/goals-page';
import { HomePage } from './forecast/home-page';
import { MonthPage } from './forecast/month-page';
import { ReservePage } from './forecast/reserve-page';
import { BalancePage } from './entry/balance-page';
import { PaymentPage } from './entry/payment-page';
import { MembersPage } from './members/members-page';
import { MorePage } from './shell/more-page';

/**
 * Eagerly loaded, every one: a lazy route never visited would not exist
 * offline (ADR-006).
 */
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', component: HomePage, title: 'Home Mgmt' },
  { path: 'month', component: MonthPage, title: 'Month' },
  { path: 'month/:ym', component: MonthPage, title: 'Month' },
  { path: 'cashflow', component: CashflowPage, title: 'Cashflow' },
  { path: 'reserve', component: ReservePage, title: 'Reserve' },
  { path: 'goals', component: GoalsPage, title: 'Goals' },
  { path: 'balance', component: BalancePage, title: 'Balance' },
  { path: 'income/new', component: PaymentPage, title: 'Expected payment' },
  { path: 'flows', component: FlowList, title: 'Flows' },
  { path: 'flows/:id', component: FlowEditor, title: 'Flow' },
  { path: 'members', component: MembersPage, title: 'Members' },
  { path: 'categories', component: CategoriesPage, title: 'Categories' },
  { path: 'more', component: MorePage, title: 'More' },
  { path: '**', redirectTo: '' },
];
