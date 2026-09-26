/**
 * Tests for the migration safety linter.
 *
 * Covers:
 *  - Safe SQL passes without violations
 *  - CREATE INDEX without CONCURRENTLY is flagged
 *  - ALTER TABLE ADD COLUMN NOT NULL without DEFAULT is flagged
 *  - DROP TABLE is flagged
 *  - TRUNCATE is flagged
 *  - Multiple violations in one file are all reported
 *  - lintMigrations scans a directory correctly
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { lintSql, lintMigrations, VIOLATION_RULES } from '../migrations/migration-safety';

// ── lintSql unit tests ────────────────────────────────────────────────────────

describe('lintSql — safe SQL', () => {
  it('passes CREATE INDEX CONCURRENTLY', () => {
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "foo_idx" ON "Foo"("bar");`;
    expect(lintSql(sql, 'test.sql')).toHaveLength(0);
  });

  it('passes CREATE TABLE with nullable columns', () => {
    const sql = `
      CREATE TABLE "Foo" (
        "id" TEXT NOT NULL,
        "name" TEXT,
        CONSTRAINT "Foo_pkey" PRIMARY KEY ("id")
      );
    `;
    expect(lintSql(sql, 'test.sql')).toHaveLength(0);
  });

  it('passes ALTER TABLE ADD COLUMN with a DEFAULT', () => {
    const sql = `ALTER TABLE "Foo" ADD COLUMN "count" INTEGER NOT NULL DEFAULT 0;`;
    expect(lintSql(sql, 'test.sql')).toHaveLength(0);
  });

  it('passes an empty SQL file', () => {
    expect(lintSql('', 'empty.sql')).toHaveLength(0);
  });

  it('passes SQL with only comments', () => {
    const sql = `-- This is a safe migration\n-- Nothing to do here.\n`;
    expect(lintSql(sql, 'comments.sql')).toHaveLength(0);
  });
});

describe('lintSql — CREATE INDEX without CONCURRENTLY', () => {
  it('flags basic CREATE INDEX', () => {
    const sql = `CREATE INDEX "foo_idx" ON "Foo"("bar");`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
  });

  it('flags CREATE UNIQUE INDEX without CONCURRENTLY', () => {
    const sql = `CREATE UNIQUE INDEX "foo_unique" ON "Foo"("bar");`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
  });

  it('flags CREATE INDEX IF NOT EXISTS without CONCURRENTLY', () => {
    const sql = `CREATE INDEX IF NOT EXISTS "foo_idx" ON "Foo"("bar");`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
  });

  it('does NOT flag CREATE INDEX CONCURRENTLY', () => {
    const sql = `CREATE INDEX CONCURRENTLY "foo_idx" ON "Foo"("bar");`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.every(v => v.rule !== 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
  });

  it('does NOT flag CREATE INDEX CONCURRENTLY IF NOT EXISTS', () => {
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "foo_idx" ON "Foo"("bar");`;
    expect(lintSql(sql, 'test.sql')).toHaveLength(0);
  });
});

describe('lintSql — ADD COLUMN NOT NULL without DEFAULT', () => {
  it('flags ADD COLUMN NOT NULL without DEFAULT', () => {
    const sql = `ALTER TABLE "Foo" ADD COLUMN "bar" TEXT NOT NULL;`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'ADD_COLUMN_NOT_NULL_NO_DEFAULT')).toBe(true);
  });

  it('does NOT flag ADD COLUMN NOT NULL with DEFAULT', () => {
    const sql = `ALTER TABLE "Foo" ADD COLUMN "bar" TEXT NOT NULL DEFAULT 'x';`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.every(v => v.rule !== 'ADD_COLUMN_NOT_NULL_NO_DEFAULT')).toBe(true);
  });

  it('does NOT flag ADD COLUMN nullable', () => {
    const sql = `ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;`;
    expect(lintSql(sql, 'test.sql')).toHaveLength(0);
  });
});

describe('lintSql — DROP TABLE', () => {
  it('flags DROP TABLE', () => {
    const sql = `DROP TABLE "Foo";`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'DROP_TABLE')).toBe(true);
  });

  it('flags DROP TABLE IF EXISTS', () => {
    const sql = `DROP TABLE IF EXISTS "Foo";`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'DROP_TABLE')).toBe(true);
  });
});

describe('lintSql — TRUNCATE', () => {
  it('flags TRUNCATE TABLE', () => {
    const sql = `TRUNCATE TABLE "Foo";`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'TRUNCATE')).toBe(true);
  });

  it('flags TRUNCATE on its own line', () => {
    const sql = `\nTRUNCATE "Foo";\n`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.some(v => v.rule === 'TRUNCATE')).toBe(true);
  });

  it('does NOT flag a column named truncated (not a statement)', () => {
    // TRUNCATE as a word inside a string value or column reference is safe
    // The regex requires TRUNCATE at line start
    const sql = `INSERT INTO "Log"("message") VALUES ('row was truncated');`;
    const violations = lintSql(sql, 'test.sql');
    expect(violations.every(v => v.rule !== 'TRUNCATE')).toBe(true);
  });
});

describe('lintSql — multiple violations', () => {
  it('reports all violations in one file', () => {
    const sql = `
      -- Multiple problems
      CREATE INDEX "a" ON "A"("x");
      ALTER TABLE "B" ADD COLUMN "y" TEXT NOT NULL;
      DROP TABLE "C";
      TRUNCATE "D";
    `;
    const violations = lintSql(sql, 'multi.sql');
    const rules = violations.map(v => v.rule);
    expect(rules).toContain('CREATE_INDEX_WITHOUT_CONCURRENTLY');
    expect(rules).toContain('ADD_COLUMN_NOT_NULL_NO_DEFAULT');
    expect(rules).toContain('DROP_TABLE');
    expect(rules).toContain('TRUNCATE');
  });

  it('includes file, rule, and message in each violation', () => {
    const sql = `DROP TABLE "X";`;
    const violations = lintSql(sql, 'my-migration.sql');
    expect(violations[0]).toMatchObject({
      file: 'my-migration.sql',
      rule: 'DROP_TABLE',
      message: expect.stringContaining('DROP TABLE'),
    });
  });
});

// ── VIOLATION_RULES export ─────────────────────────────────────────────────────

describe('VIOLATION_RULES', () => {
  it('defines 4 rules', () => {
    expect(VIOLATION_RULES).toHaveLength(4);
  });

  it('every rule has name, pattern, and message', () => {
    for (const rule of VIOLATION_RULES) {
      expect(rule.name).toBeTruthy();
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.message).toBeTruthy();
    }
  });
});

// ── lintMigrations ─────────────────────────────────────────────────────────────

describe('lintMigrations', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carbonledger-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when migrations directory does not exist', () => {
    expect(() => lintMigrations('/nonexistent/path')).toThrow();
  });

  it('returns empty array for an empty migrations directory', () => {
    expect(lintMigrations(tmpDir)).toHaveLength(0);
  });

  it('returns no violations for safe migrations', () => {
    const dir = path.join(tmpDir, '20240101_safe');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'migration.sql'),
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "x_idx" ON "X"("y");\n`,
    );
    expect(lintMigrations(tmpDir)).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns violations for unsafe CREATE INDEX', () => {
    const dir = path.join(tmpDir, '20240102_unsafe_index');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'migration.sql'),
      `CREATE INDEX "bad_idx" ON "Foo"("col");\n`,
    );
    const violations = lintMigrations(tmpDir);
    expect(violations.some(v => v.rule === 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('scans multiple migration directories', () => {
    const dir1 = path.join(tmpDir, '20240103_a');
    const dir2 = path.join(tmpDir, '20240104_b');
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, 'migration.sql'), `DROP TABLE "A";\n`);
    fs.writeFileSync(path.join(dir2, 'migration.sql'), `TRUNCATE "B";\n`);

    // No allowlist — both should be flagged
    const violations = lintMigrations(tmpDir);
    const rules = violations.map(v => v.rule);
    expect(rules).toContain('DROP_TABLE');
    expect(rules).toContain('TRUNCATE');

    fs.rmSync(dir1, { recursive: true });
    fs.rmSync(dir2, { recursive: true });
  });

  it('respects allowlist — skips grandfathered migrations', () => {
    const dir1 = path.join(tmpDir, '20240103_grandfathered');
    const dir2 = path.join(tmpDir, '20240104_new');
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, 'migration.sql'), `DROP TABLE "A";\n`);
    fs.writeFileSync(path.join(dir2, 'migration.sql'), `DROP TABLE "B";\n`);

    const violations = lintMigrations(tmpDir, ['20240103_grandfathered']);
    // Only the new (non-allowlisted) migration should be flagged
    expect(violations.some(v => v.file.includes('20240104_new'))).toBe(true);
    expect(violations.every(v => !v.file.includes('20240103_grandfathered'))).toBe(true);

    fs.rmSync(dir1, { recursive: true });
    fs.rmSync(dir2, { recursive: true });
  });

  it('skips directories without a migration.sql', () => {
    const dir = path.join(tmpDir, '20240105_no_sql');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'rollback.sql'), `DROP TABLE "X";\n`);
    // No migration.sql — should not be processed
    const violations = lintMigrations(tmpDir);
    expect(violations.every(v => !v.file.includes('20240105_no_sql'))).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── Existing CarbonLedger migrations audit ────────────────────────────────────

describe('existing migrations safety audit', () => {
  const migrationsDir = path.join(
    __dirname, '..', '..', '..', '..', 'backend', 'prisma', 'migrations',
  );

  it('add_missing_indexes migration uses CREATE INDEX without CONCURRENTLY (known issue)', () => {
    const sqlFile = path.join(migrationsDir, '20260718000000_add_missing_indexes', 'migration.sql');
    if (!fs.existsSync(sqlFile)) {
      console.warn('Migration file not found, skipping audit test');
      return;
    }
    const sql = fs.readFileSync(sqlFile, 'utf-8');
    const violations = lintSql(sql, sqlFile);
    // We know this migration uses CREATE INDEX without CONCURRENTLY
    expect(violations.some(v => v.rule === 'CREATE_INDEX_WITHOUT_CONCURRENTLY')).toBe(true);
  });

  it('add_observability_tables, add_api_keys, add_admin_config, add_idempotency_record are otherwise safe', () => {
    const safeMigrations = [
      '20260428100000_add_observability_tables',
      '20260505000000_add_api_keys',
      '20260427000000_add_admin_config',
      '20260716000000_add_idempotency_record',
    ];
    for (const name of safeMigrations) {
      const sqlFile = path.join(migrationsDir, name, 'migration.sql');
      if (!fs.existsSync(sqlFile)) continue;
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      const violations = lintSql(sql, sqlFile).filter(
        v => v.rule !== 'CREATE_INDEX_WITHOUT_CONCURRENTLY',
      );
      expect(violations).toHaveLength(0);
    }
  });
});
