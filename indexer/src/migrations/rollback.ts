#!/usr/bin/env ts-node
/**
 * migrate:rollback — applies the rollback.sql of the most recently applied migration.
 *
 * Usage:
 *   npx ts-node src/migrations/rollback.ts [migrations-dir]
 *
 * Reads the last directory (alphabetically = last applied) under migrationsDir
 * that contains a rollback.sql and executes it against DATABASE_URL.
 *
 * Requires DATABASE_URL environment variable.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const DEFAULT_MIGRATIONS_DIR = path.join(
  __dirname,
  '..', '..', '..', 'backend', 'prisma', 'migrations',
);

export function findLastRollback(migrationsDir: string): { dir: string; file: string } | null {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // alphabetical = chronological for timestamp-prefixed dirs

  // Iterate from last to first to find latest one with a rollback.sql
  for (let i = dirs.length - 1; i >= 0; i--) {
    const rollbackFile = path.join(migrationsDir, dirs[i], 'rollback.sql');
    if (fs.existsSync(rollbackFile)) {
      return { dir: dirs[i], file: rollbackFile };
    }
  }

  return null;
}

if (require.main === module) {
  const migrationsDir = process.argv[2] ?? DEFAULT_MIGRATIONS_DIR;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('[migrate:rollback] Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  let rollback: { dir: string; file: string } | null;
  try {
    rollback = findLastRollback(migrationsDir);
  } catch (err) {
    console.error(`[migrate:rollback] Error: ${(err as Error).message}`);
    process.exit(1);
  }

  if (!rollback) {
    console.error('[migrate:rollback] No rollback.sql found in any migration directory.');
    process.exit(1);
  }

  console.log(`[migrate:rollback] Applying rollback for: ${rollback.dir}`);
  console.log(`[migrate:rollback] File: ${rollback.file}`);

  try {
    execSync(`psql "${databaseUrl}" -f "${rollback.file}"`, { stdio: 'inherit' });
    console.log('[migrate:rollback] ✓ Rollback applied successfully.');
  } catch (err) {
    console.error('[migrate:rollback] ✗ Rollback failed:', (err as Error).message);
    process.exit(1);
  }
}
