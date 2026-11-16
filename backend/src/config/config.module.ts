import { existsSync } from 'node:fs';
import { Global, Module } from '@nestjs/common';
import { parseConfig, type AppConfig } from './config.js';

/** Injection token for the parsed, validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Reads `.env` if there is one (real environment variables win), then validates everything once. */
export function loadConfig(): AppConfig {
  if (existsSync('.env')) process.loadEnvFile('.env');
  return parseConfig(process.env);
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
