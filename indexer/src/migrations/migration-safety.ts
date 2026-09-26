#!/usr/bin/env ts-node
/**
 * Migration safety linter — npm run migrate:check
 *
 * Parses every SQL file under the migrations directory and fails
 * if any of the following table-locking patterns are found:
 *
 *  1. CREATE INDEX without CONCURRENTLY
 *  2. ALTER TABLE ... ADD COLUMN ... NOT NULL without a DEFAULT clause
 *  3. DROP TABLE
 *  4. TRUNCATE
 *
 * Exit code 0 = all migrations are safe.
 * Exit code 1 = at least one violation found.
 *
 * Usage:
 *   npx ts-node src/migrations/migration-safety.ts [migrations-dir]
 *
 * Default migrations dir: ../../backend/prisma/migrations
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Violation rules ───────────────────────────────────────────────────────────

export interface ViolationRule {
  name: string;
  pattern: RegExp;
  message: string;
}

export const VIOLATION_RULES: ViolationRule[] = [
  {
    name: 'CREATE_INDEX_WITHOUT_CONCURRENTLY',
    // Matches CREATE INDEX (or CREATE UNIQUE INDEX) not followed by CONCURRENTLY
    // Uses negative lookahead to exclude IF NOT EXISTS + CONCURRENTLY combos
    pattern: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)(?:IF\s+NOT\s+EXISTS\s+)?(?!\s*CONCURRENTLY)\w/i,
    message:
      'CREATE INDEX without CONCURRENTLY locks the table. ' +
      'Use CREATE INDEX CONCURRENTLY to avoid downtime.',
  },
  {
    name: 'ADD_COLUMN_NOT_NULL_NO_DEFAULT',
    // Matches ADD COLUMN <name> <type> NOT NULL without a DEFAULT keyword on the same statement
    pattern: /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+\S+\s+\S+(?:\s+\S+)*?\s+NOT\s+NULL(?!\s)/i,
    message:
      'ADD COLUMN ... NOT NULL without a DEFAULT locks the table. ' +
      'Use a three-phase approach: add nullable, backfill, then add NOT NULL constraint.',
  },
  {
    name: 'DROP_TABLE',
    pattern: /DROP\s+TABLE/i,
    message:
      'DROP TABLE is a destructive operation. ' +
      'Add a rollback.sql before applying, or use a rename-then-drop strategy.',
  },
  {
    name: 'TRUNCATE',
    pattern: /^\s*TRUNCATE\b/im,
    message:
      'TRUNCATE acquires an exclusive lock and is destructive. ' +
      'Use DELETE with a WHERE clause for incremental deletion.',
  },
];

// ── Linter logic ──────────────────────────────────────────────────────────────

export interface LintViolation {
  file: string;
  rule: string;
  line: number;
  text: string;
  message: string;
}

/**
 * Strip SQL line comments (-- ...) from a line but preserve the rest.
 * Block comments (/* ... *\/) are not handled here for simplicity.
 */
function stripLineComment(line: string): string {
  const idx = line.indexOf('--');
  if (idx === -1) return line;
  return line.slice(0, idx);
}

/**
 * Check CREATE INDEX without CONCURRENTLY more carefully by looking at the
 * full statement rather than line by line.
 * Uses a regex with a global flag to find all occurrences and report each once.
 */
function checkCreateIndex(sql: string, filePath: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const reConcurrent = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i;

  // Find every CREATE INDEX statement (split on semicolons, one violation per statement)
  const statements = sql.split(';');

  let lineOffset = 0;
  for (const stmt of statements) {
    const stmtLines = stmt.split('\n');
    const trimmed = stmt.trim();

    if (/CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(trimmed) && !reConcurrent.test(trimmed)) {
      // Find the first non-comment, non-empty line of the statement for reporting
      const firstCodeLine = stmtLines.find(l => l.trim() && !l.trim().startsWith('--'));
      violations.push({
        file: filePath,
        rule: 'CREATE_INDEX_WITHOUT_CONCURRENTLY',
        line: lineOffset + 1,
        text: (firstCodeLine ?? stmtLines[0]).trim().slice(0, 120),
        message: VIOLATION_RULES[0].message,
      });
    }

    lineOffset += stmtLines.length;
  }

  return violations;
}

/**
 * Lint a single SQL string. Returns a list of violations.
 */
export function lintSql(sql: string, filePath: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const lines = sql.split('\n');

  // Check CREATE INDEX at statement level for better accuracy
  violations.push(...checkCreateIndex(sql, filePath));

  // Check other rules line by line
  lines.forEach((rawLine, idx) => {
    const line = stripLineComment(rawLine);
    const lineNum = idx + 1;

    for (const rule of VIOLATION_RULES) {
      if (rule.name === 'CREATE_INDEX_WITHOUT_CONCURRENTLY') continue; // handled above

      if (rule.pattern.test(line)) {
        // For ADD COLUMN NOT NULL, check if DEFAULT also appears in the same line
        if (rule.name === 'ADD_COLUMN_NOT_NULL_NO_DEFAULT') {
          if (/DEFAULT\s/i.test(line)) continue; // safe — has a default
        }

        violations.push({
          file: filePath,
          rule: rule.name,
          line: lineNum,
          text: rawLine.trim().slice(0, 100),
          message: rule.message,
        });
      }
    }
  });

  return violations;
}

/**
 * Scan all migration.sql files under `migrationsDir` and return all violations.
 * Pass `allowlist` with migration directory names to skip (grandfathered migrations).
 */
export function lintMigrations(
  migrationsDir: string,
  allowlist: string[] = [],
): LintViolation[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const allViolations: LintViolation[] = [];
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (allowlist.includes(entry.name)) continue; // skip grandfathered migration

    const sqlFile = path.join(migrationsDir, entry.name, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;

    const sql = fs.readFileSync(sqlFile, 'utf-8');
    const violations = lintSql(sql, sqlFile);
    allViolations.push(...violations);
  }

  return allViolations;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

/**
 * Existing migrations that pre-date this linter and were applied to empty tables.
 * These are documented as safe in CONTRIBUTING-SCHEMA-CHANGES.md.
 * Add new migrations here ONLY with a documented justification — do not use this
 * list to bypass the linter for genuinely unsafe migrations.
 */
const GRANDFATHERED_MIGRATIONS = [
  '20260427000000_add_admin_config',
  '20260428100000_add_observability_tables',
  '20260505000000_add_api_keys',
  '20260716000000_add_idempotency_record',
  '20260718000000_add_missing_indexes',
];

if (require.main === module) {
  const migrationsDir =
    process.argv[2] ??
    path.join(__dirname, '..', '..', '..', 'backend', 'prisma', 'migrations');

  console.log(`[migrate:check] Scanning migrations in: ${migrationsDir}`);
  console.log(`[migrate:check] Grandfathered (skipped): ${GRANDFATHERED_MIGRATIONS.join(', ')}\n`);

  let violations: LintViolation[];
  try {
    violations = lintMigrations(migrationsDir, GRANDFATHERED_MIGRATIONS);
  } catch (err) {
    console.error(`[migrate:check] Error: ${(err as Error).message}`);
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log('[migrate:check] ✓ All new migrations are safe.');
    process.exit(0);
  }

  console.error(`[migrate:check] ✗ Found ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  File: ${v.file}`);
    console.error(`  Rule: ${v.rule}`);
    console.error(`  Line: ${v.line}`);
    console.error(`  SQL:  ${v.text}`);
    console.error(`  Fix:  ${v.message}\n`);
  }

  process.exit(1);
}
