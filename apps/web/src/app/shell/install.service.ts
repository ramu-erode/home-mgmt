import { Injectable, signal } from '@angular/core';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Whether the app is installed to the home screen, and whether its storage is
 * protected from eviction (ADR-006). Safari clears IndexedDB for sites not
 * visited recently; installed home-screen apps are exempt. Until the app is
 * installed, unsynced changes on this phone are at risk.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  readonly installed = signal(isStandalone());
  /** True once the browser has granted persistent storage; null if it cannot say. */
  readonly persistent = signal<boolean | null>(null);
  /** Android/Chrome offer a native install prompt; iOS never does. */
  readonly canPrompt = signal(false);
  readonly ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

  private deferred: InstallPromptEvent | null = null;

  constructor() {
    globalThis.addEventListener?.('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as InstallPromptEvent;
      this.canPrompt.set(true);
    });
    globalThis.addEventListener?.('appinstalled', () => this.installed.set(true));
    void this.askForPersistence();
  }

  async prompt(): Promise<void> {
    if (!this.deferred) return;
    await this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    if (outcome === 'accepted') this.installed.set(true);
    this.deferred = null;
    this.canPrompt.set(false);
  }

  private async askForPersistence(): Promise<void> {
    const storage = navigator.storage;
    if (!storage?.persisted) return;
    try {
      this.persistent.set((await storage.persisted()) || (await storage.persist()));
    } catch {
      this.persistent.set(null);
    }
  }
}

function isStandalone(): boolean {
  return globalThis.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}
