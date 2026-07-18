import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const executableSetupPaths = [
  'server/src/services/initializationService.ts',
  'server/src/scripts/setup-storage.ts',
  'server/src/scripts/verify-schema.ts',
  'supabase/functions/setup-storage/index.ts',
];

describe('videos storage privacy contract', () => {
  it('never makes the videos bucket or its objects public from a setup path', () => {
    for (const relativePath of executableSetupPaths) {
      const source = read(relativePath);
      expect(source).not.toMatch(/public:\s*true/);
      expect(source).not.toContain('Public can view videos');
    }
  });

  it('routes initialization through the canonical private bucket helper', () => {
    const source = read('server/src/services/initializationService.ts');
    expect(source).toContain("import { StorageService } from './storageService'");
    expect(source).toContain('StorageService.ensureBucketExists()');
  });

  it('forces both missing and existing buckets private in standalone setup tools', () => {
    for (const relativePath of [
      'server/src/scripts/setup-storage.ts',
      'server/src/scripts/verify-schema.ts',
      'supabase/functions/setup-storage/index.ts',
    ]) {
      const source = read(relativePath);
      expect(source).toContain('public: false');
      expect(source).toContain('updateBucket');
    }
  });

  it('does not preserve a copyable public-read policy in skipped history', () => {
    expect(read('supabase/migrations/20240224_storage_policies.sql.skip'))
      .not.toContain('Public can view videos');
  });

  it('ships an idempotent migration that removes the legacy public-read policy', () => {
    const migrationsDir = path.join(repoRoot, 'supabase/migrations');
    expect(existsSync(migrationsDir)).toBe(true);
    const activeMigrations = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(path.join(migrationsDir, name), 'utf8'))
      .join('\n');

    expect(activeMigrations).toContain(
      'DROP POLICY IF EXISTS "Public can view videos" ON storage.objects;',
    );
  });
});
