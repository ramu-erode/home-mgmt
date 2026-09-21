import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { DEVICE_HEADER, type PullResponse, type PushResponse } from '@home-mgmt/shared';
import { ProtocolGuard } from './protocol.guard';
import { SyncService } from './sync.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('sync')
@UseGuards(ProtocolGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  pull(@Query('since') since = '0'): Promise<PullResponse> {
    if (!/^\d+$/.test(since)) throw new BadRequestException('since must be a non-negative integer version');
    return this.sync.pull(BigInt(since));
  }

  @Post()
  @HttpCode(200)
  push(@Body() body: { operations?: unknown }, @Headers(DEVICE_HEADER) deviceId?: string): Promise<PushResponse> {
    if (!deviceId || !UUID.test(deviceId)) throw new BadRequestException(`${DEVICE_HEADER} must be the device UUID`);
    if (!Array.isArray(body?.operations)) throw new BadRequestException('body.operations must be an array');
    return this.sync.push(body.operations, deviceId.toLowerCase());
  }
}
