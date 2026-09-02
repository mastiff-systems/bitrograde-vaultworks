/**
 * MAS-732: version source-of-truth guard (per MAS-731 design).
 *
 * The root package.json is the single source of truth; scripts/release.sh
 * writes the same version into frontend/ and backend/ package.json in the
 * release commit. This test fails the suite if the three ever drift, and
 * pins the build-time __APP_VERSION__ constant to the root value.
 */
import { describe, it, expect } from 'vitest';
import rootPkg from '../../../package.json';
import frontendPkg from '../../package.json';
import backendPkg from '../../../backend/package.json';

describe('version source of truth (MAS-732)', () => {
  it('root/frontend/backend package.json versions are in sync', () => {
    expect(rootPkg.name).toBe('bitrograde-vaultworks');
    expect(frontendPkg.version).toBe(rootPkg.version);
    expect(backendPkg.version).toBe(rootPkg.version);
  });

  it('__APP_VERSION__ is injected from the root package.json', () => {
    expect(__APP_VERSION__).toBe(rootPkg.version);
  });
});
