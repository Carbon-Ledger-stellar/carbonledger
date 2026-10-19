import { validateEnv, REQUIRED_ENV_VARS } from './env.validation';

describe('validateEnv', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the parsed config when all required vars are present', () => {
    process.env = {
      ...originalEnv,
      ...Object.fromEntries(REQUIRED_ENV_VARS.map((key) => [key, 'test-value'])),
    };

    expect(() => validateEnv(process.env)).not.toThrow();
  });

  it('fails fast and lists every missing required variable', () => {
    const env = { ...originalEnv };
    for (const key of REQUIRED_ENV_VARS) {
      delete env[key];
    }

    expect(() => validateEnv(env)).toThrow(/Missing required environment variables/);

    try {
      validateEnv(env);
    } catch (error) {
      const message = (error as Error).message;
      for (const key of REQUIRED_ENV_VARS) {
        expect(message).toContain(key);
      }
    }
  });

  it('reports only the variables that are actually missing', () => {
    const env = {
      ...originalEnv,
      ...Object.fromEntries(REQUIRED_ENV_VARS.map((key) => [key, 'test-value'])),
    };
    const missing = REQUIRED_ENV_VARS[0];
    delete env[missing];

    try {
      validateEnv(env);
      fail('expected validateEnv to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(missing);
      for (const key of REQUIRED_ENV_VARS.slice(1)) {
        expect(message).not.toContain(key);
      }
    }
  });
});
