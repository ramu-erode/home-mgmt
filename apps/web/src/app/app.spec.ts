import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { ApiClient } from './data/api-client';
import { LocalDb } from './data/local-db';
import { Household } from './data/household';
import { LocalStore } from './data/local-store';
import { LOCAL_DB, SyncService } from './data/sync.service';

describe('App', () => {
  let db: LocalDb;

  beforeEach(async () => {
    db = new LocalDb(`test-${crypto.randomUUID()}`);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
        { provide: LOCAL_DB, useValue: db },
        // The Mac is unreachable: the app must still open.
        { provide: ApiClient, useValue: { push: async () => ({ kind: 'offline' }), pull: async () => ({ kind: 'offline' }) } },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    TestBed.inject(SyncService).stop();
    db.close();
    await db.delete();
  });

  it('leaves setup once the phone is named and linked to a member', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const store = TestBed.inject(LocalStore);
    await store.save('member', { id: 'm1', name: 'Parent A', displayOrder: 1 });
    await store.save('device', { id: await TestBed.inject(SyncService).deviceId(), name: 'Phone', memberId: 'm1' });
    await new Promise((r) => setTimeout(r, 50));
    await fixture.whenStable();
    expect(TestBed.inject(Household).deviceReady()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Set up this phone');
  });

  it('asks whose phone this is on first launch, even offline', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 50));
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Set up this phone');
    expect(text).toContain('Offline');
  });
});
