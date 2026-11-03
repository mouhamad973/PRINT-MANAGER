import type { HealthReport } from '@arksen/shared-types';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthReportDto } from './health.dto.js';
import { Public } from '../auth/decorators.js';
import { HealthService } from './health.service.js';

@Public()
@ApiTags('Système')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Vérifie réellement chaque dépendance de la plateforme' })
  @ApiResponse({ status: 200, type: HealthReportDto, description: 'Opérationnelle ou dégradée' })
  @ApiResponse({ status: 503, type: HealthReportDto, description: 'Dépendance critique absente' })
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await this.healthService.check();
    response.status(report.status === 'error' ? 503 : 200);
    return report;
  }
}
