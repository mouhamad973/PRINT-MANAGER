import type { DependencyHealth, HealthReport } from '@arksen/shared-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DependencyHealthDto implements DependencyHealth {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiProperty()
  critical!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  latencyMs!: number | null;

  @ApiPropertyOptional()
  message?: string;
}

class DependenciesDto {
  @ApiProperty({ type: DependencyHealthDto })
  database!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  redis!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  analytics!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  workers!: DependencyHealthDto;
}

export class HealthReportDto implements HealthReport {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'] })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty()
  version!: string;

  @ApiProperty({ format: 'date-time' })
  checkedAt!: string;

  @ApiProperty({ type: DependenciesDto })
  dependencies!: DependenciesDto;
}
