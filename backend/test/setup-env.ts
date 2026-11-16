// Runs before the end-to-end tests: load .env the same way the app does (real environment variables win).
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
