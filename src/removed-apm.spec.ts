import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('Backend without external APM agent', () => {
  const root = resolve(__dirname, '..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

  it('does not declare the removed agent or its install permissions', () => {
    expect(manifest.dependencies?.newrelic).toBeUndefined();
    expect(manifest.devDependencies?.newrelic).toBeUndefined();
    expect(Object.keys(manifest.allowScripts || {}).some(name => /newrelic/i.test(name))).toBe(false);
  });

  it('starts without an agent preload or remote APM smoke command', () => {
    for (const name of ['start', 'start:dev', 'start:debug', 'start:prod'])
      expect(manifest.scripts[name]).not.toMatch(/newrelic/i);
    expect(manifest.scripts['newrelic:smoke']).toBeUndefined();
  });

  it('does not ship the agent configuration or smoke implementation', () => {
    expect(existsSync(resolve(root, 'newrelic.js'))).toBe(false);
    expect(existsSync(resolve(root, 'scripts/newrelic-smoke-test.js'))).toBe(false);
  });

  it('requires no monitoring flags in its environment example', () => {
    expect(readFileSync(resolve(root, '.env.example'), 'utf8')).not.toMatch(/^\s*NEW_RELIC_/m);
  });
});
