import { startEgressProxy } from './egress-proxy.js';

async function main() {
  const port = Number(process.env.BROWOS_PROXY_PORT ?? '3128');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid egress proxy port.');
  const proxy = await startEgressProxy({
    host: process.env.BROWOS_PROXY_HOST ?? '127.0.0.1',
    port,
    token: process.env.BROWOS_EGRESS_PROXY_TOKEN ?? '',
  });
  process.stdout.write(`BROwOS authenticated egress proxy listening on port ${port}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await proxy.close();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

main().catch(() => {
  process.stderr.write(
    'BROwOS egress proxy could not start. Check its host, port and 32+ character token.\n',
  );
  process.exitCode = 1;
});
