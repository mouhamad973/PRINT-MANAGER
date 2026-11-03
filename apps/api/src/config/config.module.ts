import { apiEnvSchema, parseEnv } from '@arksen/validation';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './app-config.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseEnv(apiEnvSchema, process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
