import { DEPLOYMENT_MODES, type DeploymentMode, type SystemInfo } from '@arksen/shared-types';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { API_NAME, API_VERSION } from '../version.js';

class SystemInfoDto implements SystemInfo {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  version!: string;

  @ApiProperty({ enum: DEPLOYMENT_MODES })
  deploymentMode!: DeploymentMode;
}

@Public()
@ApiTags('Système')
@Controller('system')
export class SystemController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('info')
  @ApiOperation({ summary: 'Identité et mode de déploiement de la plateforme' })
  @ApiOkResponse({ type: SystemInfoDto })
  info(): SystemInfo {
    return {
      name: API_NAME,
      version: API_VERSION,
      deploymentMode: this.config.DEPLOYMENT_MODE,
    };
  }
}
