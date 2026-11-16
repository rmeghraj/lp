import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { AppConfig } from './config/config.js';
import { APP_CONFIG } from './config/config.module.js';

const app = await NestFactory.create(AppModule);
const config = app.get<AppConfig>(APP_CONFIG);
configureApp(app, config);
await app.listen(config.port);

new Logger('Bootstrap').log(`Listening on http://localhost:${config.port}/api (LLM provider: ${config.llm.provider})`);
