import { createApiServer } from './api.js';
import { readConfig } from './config.js';
import { ChromiumSessions } from './sessions.js';

async function main() {
  const config = readConfig();
  let externalProxy: { url: string; token: string } | undefined;
  if (process.env.BROWOS_EGRESS_PROXY_URL) {
    const url = new URL(process.env.BROWOS_EGRESS_PROXY_URL);
    const token = process.env.BROWOS_EGRESS_PROXY_TOKEN ?? '';
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      token.length < 32
    ) {
      throw new Error(
        'External egress requires an HTTP proxy URL and a separate 32+ character BROWOS_EGRESS_PROXY_TOKEN.',
      );
    }
    externalProxy = { url: url.origin, token };
  }
  const sessions = new ChromiumSessions(config, { externalProxy });
  const server = createApiServer(config, sessions);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  process.stdout.write(`BROwOS Chromium API listening on ${config.host}:${config.port}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await sessions.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

main().catch((error: unknown) => {
  // Config errors contain only field names; never print tokens, URLs or browser launch logs.
  const message =
    error instanceof Error && !error.message.includes('\n')
      ? error.message
      : 'Server startup failed.';
  process.stderr.write(`BROwOS: ${message}\n`);
  process.exitCode = 1;
});
