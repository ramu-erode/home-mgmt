import { Injectable } from '@angular/core';
import { DEVICE_HEADER, PROTOCOL_HEADER, PROTOCOL_VERSION, type Operation, type PullResponse, type PushResponse } from '@home-mgmt/shared';

export type ApiResult<T> =
  | { kind: 'ok'; body: T }
  /** The Mac is off, asleep, or the phone has no route to the tailnet. */
  | { kind: 'offline' }
  /** 426 — this bundle speaks a protocol the server no longer accepts (ADR-009). */
  | { kind: 'update-required' }
  | { kind: 'error'; status: number; message: string };

/**
 * The only code that talks to the network, and only the sync service calls it.
 * Same origin (ADR-005); the tailnet identity header is added by
 * `tailscale serve`, not here (ADR-014).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  pull(since: string, deviceId: string): Promise<ApiResult<PullResponse>> {
    return this.request<PullResponse>(`/api/sync?since=${encodeURIComponent(since)}`, { method: 'GET' }, deviceId);
  }

  push(operations: Operation[], deviceId: string): Promise<ApiResult<PushResponse>> {
    return this.request<PushResponse>('/api/sync', { method: 'POST', body: JSON.stringify({ operations }) }, deviceId);
  }

  private async request<T>(url: string, init: RequestInit, deviceId: string): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'content-type': 'application/json', [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), [DEVICE_HEADER]: deviceId },
      });
    } catch {
      return { kind: 'offline' };
    }
    if (res.status === 426) return { kind: 'update-required' };
    // A 502/503/504 from `tailscale serve` means the process behind it is down.
    if (res.status === 502 || res.status === 503 || res.status === 504) return { kind: 'offline' };
    if (!res.ok) return { kind: 'error', status: res.status, message: await res.text() };
    return { kind: 'ok', body: (await res.json()) as T };
  }
}
