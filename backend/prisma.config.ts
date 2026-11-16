import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env on its own, so load it here with Node's built-in loader.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Falls back to '' so `prisma generate` works on a machine with no database (CI, fresh clone).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
