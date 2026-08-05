import { assertGatewayJwtSecretConfigured } from '../../lib/startup-guards';

describe('assertGatewayJwtSecretConfigured', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  it('refuses to start production without JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => assertGatewayJwtSecretConfigured()).toThrow(
      'JWT_SECRET is required in production',
    );
  });

  it('accepts a configured production secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'configured-secret';

    expect(() => assertGatewayJwtSecretConfigured()).not.toThrow();
  });

  it('allows local development without JWT_SECRET', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;

    expect(() => assertGatewayJwtSecretConfigured()).not.toThrow();
  });
});
