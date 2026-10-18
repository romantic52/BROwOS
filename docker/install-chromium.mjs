// Official Playwright first, official matching Chrome for Testing artifact as CDN fallback.
// No arbitrary download host, package version change or production sandbox relaxation.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
const playwrightManifest = requireFromApp.resolve('playwright/package.json');
const requireFromPlaywright = createRequire(playwrightManifest);
const cli = path.join(path.dirname(playwrightManifest), 'cli.js');
try {
  execFileSync(process.execPath, [cli, 'install', '--no-shell', 'chromium'], { stdio: 'inherit' });
} catch {
  const core = path.dirname(requireFromPlaywright.resolve('playwright-core/package.json'));
  const metadata = JSON.parse(readFileSync(path.join(core, 'browsers.json'), 'utf8'));
  const browser = metadata.browsers.find((entry) => entry.name === 'chromium');
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(browser?.browserVersion ?? '')
  ) {
    throw new Error(
      'The official Chromium CDN failed; the verified fallback supports Linux x64 only.',
    );
  }
  const { chromium } = requireFromApp('playwright');
  const executable = chromium.executablePath();
  const root = path.dirname(path.dirname(executable));
  const archive = '/tmp/browos-chromium.zip';
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${browser.browserVersion}/linux64/chrome-linux64.zip`;
  execFileSync('curl', ['--fail', '--location', '--retry', '3', '--output', archive, url], {
    stdio: 'inherit',
  });
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  if (
    !entries.every(
      (entry) => entry.startsWith('chrome-linux64/') && !entry.split('/').includes('..'),
    )
  ) {
    throw new Error('Unexpected paths in the official browser archive.');
  }
  mkdirSync(root, { recursive: true });
  execFileSync('unzip', ['-q', '-o', archive, '-d', root]);
  rmSync(archive);
  if (!existsSync(executable))
    throw new Error('The official Chromium fallback did not provide the expected executable.');
}
