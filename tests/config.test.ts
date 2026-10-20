import { describe, it, expect } from 'vitest';
import { readConfig, publicOrigin } from '../src/server/config';

const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('runs the demo in process unless a shared demo database is given', () => {
    expect(readConfig(env({}))).toEqual({ mode: 'demo' });
    expect(
      readConfig(
        env({
          APP_MODE: 'demo',
          DEMO_DATABASE_URL: 'postgresql://u:p@db.example/demo?sslmode=require',
        }),
      ),
    ).toEqual({
      mode: 'demo',
      sharedDatabase: {
        url: 'postgresql://u:p@db.example/demo?sslmode=verify-full',
        adminUrl: 'postgresql://u:p@db.example/demo?sslmode=verify-full',
      },
    });
  });
  it('requires the public origin in live mode', () => {
    expect(() =>
      readConfig(
        env({
          APP_MODE: 'live',
          DATABASE_URL: 'postgresql://app@db.example/invoices',
          EXTRACTION_PROVIDER: 'codex',
          CODEX_MODEL: 'model',
        }),
      ),
    ).toThrow(/APP_ORIGIN/);
  });
  it('accepts a local origin for live mode on this machine, and only http(s)', () => {
    const base = {
      APP_MODE: 'live',
      DATABASE_URL: 'postgresql://app@127.0.0.1/invoices',
      EXTRACTION_PROVIDER: 'codex',
      CODEX_MODEL: 'model',
    };
    for (const APP_ORIGIN of [
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'https://invoices.example.com',
    ])
      expect(readConfig(env({ ...base, APP_ORIGIN })).mode, APP_ORIGIN).toBe(
        'live',
      );
    for (const APP_ORIGIN of ['javascript:alert(1)', 'ftp://a.example'])
      expect(() => readConfig(env({ ...base, APP_ORIGIN }))).toThrow(
        /APP_ORIGIN/,
      );
  });
  it('checks the configured origin only in live mode', () => {
    expect(
      publicOrigin(env({ APP_MODE: 'demo', APP_ORIGIN: 'https://a.example' })),
    ).toBeNull();
    expect(
      publicOrigin(
        env({ APP_MODE: 'live', APP_ORIGIN: 'https://a.example/settings' }),
      ),
    ).toBe('https://a.example');
  });
});
