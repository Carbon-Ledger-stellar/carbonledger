#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(backendRoot, 'prisma', 'migrations');
const migrationNamePattern = /^\d{14}_[a-z0-9_]+$/;
const destructivePatterns = [
  /\bdrop\s+(column|table|index|constraint|sequence)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[\s\S]*?\bdrop\b/i,
  /\balter\s+column\b[\s\S]*?\bset\s+data\s+type\b/i,
];

function lintMigrations(migrationsDirPath = migrationsDir) {
  const issues = [];
  const migrationDirs = fs.readdirSync(migrationsDirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => migrationNamePattern.test(name))
    .sort();

  if (migrationDirs.length === 0) {
    issues.push('No Prisma migration directories were found.');
  }

  for (const migrationName of migrationDirs) {
    const migrationDir = path.join(migrationsDirPath, migrationName);
    const migrationFile = path.join(migrationDir, 'migration.sql');

    if (!fs.existsSync(migrationFile)) {
      issues.push(`${migrationName}: missing migration.sql`);
      continue;
    }

    const sql = fs.readFileSync(migrationFile, 'utf8');
    const hasOverride = /migrationlint:\s*allow-destructive/i.test(sql);

    if (!hasOverride && destructivePatterns.some((pattern) => pattern.test(sql))) {
      issues.push(`${migrationName}: contains destructive SQL without an explicit override`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    migrationCount: migrationDirs.length,
  };
}

function main() {
  const result = lintMigrations();

  if (!result.passed) {
    console.error('Prisma migration lint failed:');
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Migration lint passed for ${result.migrationCount} migration(s).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  lintMigrations,
  migrationNamePattern,
  destructivePatterns,
};
