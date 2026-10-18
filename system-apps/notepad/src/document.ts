import type { DesktopServices } from '@browos/sdk';

/** Keep the version from the read, rather than silently using a later UI snapshot. */
export async function readTextDocument(fs: DesktopServices['fs'], id: string) {
  const blob = await fs.readFile(id);
  const node = fs.get(id);
  if (!node || node.trashed) throw new Error('Файл недоступен');
  const updatedAt = node.updatedAt;
  return { content: await blob.text(), updatedAt, mime: node.mime };
}

export async function saveTextDocument(
  fs: DesktopServices['fs'],
  id: string,
  content: string,
  expectedUpdatedAt: number | undefined,
  mime = 'text/plain',
) {
  if (expectedUpdatedAt === undefined) {
    throw new Error(
      'Исходный файл не был загружен. Откройте его повторно или используйте «Сохранить как».',
    );
  }
  return fs.updateFile(id, content, mime, expectedUpdatedAt);
}
