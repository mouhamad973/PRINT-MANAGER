import type { RetentionRun, RetentionStatus } from '@arksen/shared-types';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import { CurrentPrincipal, type Principal } from '../auth/principal.js';
import { RetentionService } from './retention.service.js';

@ApiTags('Administration système')
@ApiCookieAuth()
@Controller('system/retention')
export class AdminController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @RequirePermissions('platform:system:manage')
  @ApiOperation({ summary: 'Politique de conservation des données et dernière purge' })
  status(): Promise<RetentionStatus> {
    return this.retention.status();
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermissions('platform:system:manage')
  @ApiOperation({ summary: 'Applique immédiatement la politique de conservation' })
  run(@CurrentPrincipal() actor: Principal): Promise<RetentionRun> {
    return this.retention.run('manual', { userId: actor.userId, email: actor.email });
  }
}
