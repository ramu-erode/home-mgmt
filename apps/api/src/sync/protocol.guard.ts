import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MIN_PROTOCOL_VERSION, PROTOCOL_HEADER, PROTOCOL_VERSION } from '@home-mgmt/shared';

/**
 * Version skew (ADR-009). An offline phone can run an old cached bundle and
 * push old-shaped operations before its service worker sees the update. The
 * server accepts the current protocol and the one before; anything else gets
 * 426 and the client activates the update, reloads, and pushes again — its
 * outbox untouched.
 */
@Injectable()
export class ProtocolGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().header(PROTOCOL_HEADER);
    const version = Number(header);
    if (Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION && version <= PROTOCOL_VERSION) return true;
    throw new HttpException(
      { message: 'Protocol version not supported — update the app.', current: PROTOCOL_VERSION, minimum: MIN_PROTOCOL_VERSION },
      426, // Upgrade Required — not in Nest's HttpStatus enum
    );
  }
}
