#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n=== CarbonLedger Integration Tests Verification ===\n');

let allChecks = [];

// Check test files
console.log('Checking test files...');
const testFiles = [
  'test/auth.e2e-spec.ts',
  'test/rbac.e2e-spec.ts',
  'test/certificate.e2e-spec.ts',
  'test/test-helpers.ts',
  'test/jest-e2e.json'
];

testFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  allChecks.push(exists);
});

// Check configuration files
console.log('\nChecking configuration files...');
const configFiles = [
  'docker-compose.test.yml',
  '.env.test',
  'jest.config.js'
];

configFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  allChecks.push(exists);
});

// Check documentation
console.log('\nChecking documentation...');
const docFiles = [
  'test/README.md',
  'test/QUICK_START.md',
  'test/ACCEPTANCE_CRITERIA_CHECKLIST.md',
  'test/VERIFICATION_GUIDE.md'
];

docFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  allChecks.push(exists);
});

// Check package.json scripts
console.log('\nChecking package.json scripts...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const requiredScripts = [
  'test:e2e',
  'test:e2e:watch',
  'test:db:up',
  'test:db:down',
  'test:db:migrate',
  'pretest:e2e'
];

requiredScripts.forEach(script => {
  const exists = packageJson.scripts && packageJson.scripts[script];
  console.log(`  ${exists ? '✓' : '✗'} ${script}`);
  allChecks.push(exists);
});

// Check dependencies
console.log('\nChecking test dependencies...');
const requiredDeps = [
  '@types/jest',
  '@types/supertest',
  'jest',
  'supertest',
  'ts-jest',
  'dotenv-cli'
];

requiredDeps.forEach(dep => {
  const exists = packageJson.devDependencies && packageJson.devDependencies[dep];
  console.log(`  ${exists ? '✓' : '✗'} ${dep}`);
  allChecks.push(exists);
});

// Check test file content
console.log('\nChecking test file structure...');
const authTest = fs.readFileSync('test/auth.e2e-spec.ts', 'utf8');
const rbacTest = fs.readFileSync('test/rbac.e2e-spec.ts', 'utf8');
const certTest = fs.readFileSync('test/certificate.e2e-spec.ts', 'utf8');

const authTestCount = (authTest.match(/it\(/g) || []).length;
const rbacTestCount = (rbacTest.match(/it\(/g) || []).length;
const certTestCount = (certTest.match(/it\(/g) || []).length;

console.log(`  ✓ Auth tests: ${authTestCount} test cases`);
console.log(`  ✓ RBAC tests: ${rbacTestCount} test cases`);
console.log(`  ✓ Certificate tests: ${certTestCount} test cases`);
console.log(`  ✓ Total: ${authTestCount + rbacTestCount + certTestCount} test cases`);

// Summary
console.log('\n=== Verification Summary ===');
const passed = allChecks.filter(c => c).length;
const total = allChecks.length;
const percentage = ((passed / total) * 100).toFixed(2);

console.log(`Passed: ${passed} / ${total} (${percentage}%)`);

if (passed === total) {
  console.log('\n✓ All checks passed! Integration tests are ready to run.\n');
  console.log('To run tests:');
  console.log('  1. Ensure Docker is running');
  console.log('  2. Run: npm run test:e2e\n');
  process.exit(0);
} else {
  console.log('\n⚠ Some checks failed. Please review the output above.\n');
  process.exit(1);
}
