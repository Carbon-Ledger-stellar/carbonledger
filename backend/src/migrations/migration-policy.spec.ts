import { execFileSync } from 'child_process';
import * as path from 'path';

describe('database migration policy tooling', () => {
  const backendRoot = path.resolve(__dirname, '..', '..');
  const scriptsDir = path.join(backendRoot, 'scripts');

  it('accepts additive migration files for the current backend', () => {
    const output = execFileSync(process.execPath, [path.join(scriptsDir, 'lint-migrations.js')], {
      cwd: backendRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('Migration lint passed');
  });

  it('produces rollback commands for the most recent migrations', () => {
    const output = execFileSync(process.execPath, [path.join(scriptsDir, 'rollback-migrations.js'), '--count', '2'], {
      cwd: backendRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('Rollback plan');
    expect(output).toContain('npx prisma migrate resolve --rolled-back');
    expect(output).toContain('20260729000001_expand_contract_add_retirement_legacy_status');
  });
});
