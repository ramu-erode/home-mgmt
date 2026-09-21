import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../config';

const PUBLIC = 'homemgmt:public';

/** Reachable without the tailnet identity — only the health check, which the deploy script calls on loopback. */
export const Public = () => SetMetadata(PUBLIC, true);

/**
 * The tailnet is the perimeter (ADR-014). `tailscale serve` forwards
 * `Tailscale-User-Login` on every request from a user-owned node; the API binds
 * 127.0.0.1, so nothing reaches it except through serve and the header cannot
 * be forged from the tailnet.
 *
 * Fails closed in production if no login is configured.
 */
@Injectable()
export class TailnetGuard implements CanActivate {
  private readonly log = new Logger(TailnetGuard.name);
  private warned = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const expected = this.config.allowedLogin;
    if (!expected) return this.unconfigured();

    const login = context.switchToHttp().getRequest<Request>().header('tailscale-user-login');
    if (login?.toLowerCase() === expected.toLowerCase()) return true;
    throw new ForbiddenException('Not the household tailnet identity.');
  }

  private unconfigured(): boolean {
    if (this.config.production) {
      throw new ForbiddenException('TAILSCALE_ALLOWED_LOGIN is not configured.');
    }
    if (!this.warned) {
      this.log.warn('TAILSCALE_ALLOWED_LOGIN unset — allowing every request (development only).');
      this.warned = true;
    }
    return true;
  }
}
