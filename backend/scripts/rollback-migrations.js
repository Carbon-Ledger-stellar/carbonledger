#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(backendRoot, 'prisma', 'migrations');
const migrationNamePattern = /^\d{14}_[a-z0-9_]+$/;

function getRollbackPlan(migrationsDirPath = migrationsDir, count = 1) {
  const migrationNames = fs.readdirSync(migrationsDirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => migrationNamePattern.test(name))
    .sort();

  const resolvedCount = Math.max(1, Math.min(count, migrationNames.length));
  return migrationNames.slice(-resolvedCount).map((name) => ({
    name,
    command: `npx prisma migrate resolve --rolled-back ${name}`,
  }));
}

function main() {
  const args = process.argv.slice(2);
  let count = 1;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--count' && args[index + 1]) {
      count = Number.parseInt(args[index + 1], 10);
      index += 1;
    }
  }

  const plan = getRollbackPlan(migrationsDir, count);
  console.log(`Rollback plan for the last ${plan.length} migration(s):`);
  for (const step of plan) {
    console.log(step.command);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getRollbackPlan,
  migrationNamePattern,
};
