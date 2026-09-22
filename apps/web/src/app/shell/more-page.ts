import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-more-page',
  imports: [RouterLink],
  template: `
    <div class="page-head"><h1>More</h1></div>
    <nav class="card links">
      <a routerLink="/balance">Balance <span class="muted">— where the forecast starts</span></a>
      <a routerLink="/reserve">Reserve <span class="muted">— how the monthly figure is worked out</span></a>
      <a routerLink="/goals">Goals</a>
      <a routerLink="/members">Members</a>
      <a routerLink="/categories">Categories</a>
    </nav>
  `,
  styles: `.links { display: grid; padding: 0; } .links a { padding: 0.9rem; text-decoration: none; color: var(--text); border-bottom: 1px solid var(--line); } .links a:last-child { border-bottom: 0; }`,
})
export class MorePage {}
