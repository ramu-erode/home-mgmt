import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route parameters arrive as component inputs (FlowEditor's `id`).
    provideRouter(appRoutes, withComponentInputBinding()),
    // Cache-first shell (ADR-006). Registered at once, not "when stable": the
    // first visit must leave the whole app cached, or the first offline open
    // is a blank screen.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerImmediately' }),
  ],
};
