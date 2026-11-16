import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import type { AppConfig } from './config/config.js';

/** Everything `main.ts` does to the app, in one place so the end-to-end tests run the same setup. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  // Checks every @Body({ schema }) against its Zod schema and answers 400 with the problems listed.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // Only the UI's own origin may call the API from a browser.
  app.enableCors({ origin: config.corsOrigin });
  app.enableShutdownHooks();
}
