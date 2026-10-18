import { expect, test } from '@playwright/test';
import {
  boot,
  closeWelcome,
  createItem,
  fileItem,
  goToFolder,
  launchApp,
  saveDialog,
} from './helpers';

test('Explorer persists folders and real copy, rename, recycle and restore operations', async ({
  page,
}) => {
  await boot(page);
  await closeWelcome(page);
  let explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Documents');
  await createItem(explorer, 'folder', 'E2E Workspace');
  await createItem(explorer, 'file', 'original.txt');
  await fileItem(explorer, 'original.txt').click();
  await explorer.getByRole('button', { name: 'Копировать', exact: true }).click();
  await fileItem(explorer, 'E2E Workspace').dblclick();
  await explorer.getByRole('button', { name: 'Вставить', exact: true }).click();
  await expect(fileItem(explorer, 'original.txt')).toBeVisible();
  await fileItem(explorer, 'original.txt').click();
  await explorer.getByRole('button', { name: 'Переименовать', exact: true }).click();
  const rename = explorer.getByRole('dialog', { name: 'Переименовать' });
  await rename.getByRole('textbox', { name: 'Имя элемента' }).fill('restored.txt');
  await rename.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(fileItem(explorer, 'restored.txt')).toBeVisible();
  await fileItem(explorer, 'restored.txt').click();
  await explorer.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(fileItem(explorer, 'restored.txt')).not.toBeVisible();
  await explorer
    .locator('.explorer-sidebar')
    .getByRole('button', { name: /^Корзина/ })
    .click();
  await fileItem(explorer, 'restored.txt').click();
  await explorer
    .locator('.explorer-ribbon')
    .getByRole('button', { name: 'Восстановить', exact: true })
    .click();
  await expect(fileItem(explorer, 'restored.txt')).not.toBeVisible();
  await goToFolder(explorer, '/Documents/E2E Workspace');
  await expect(fileItem(explorer, 'restored.txt')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeVisible();
  explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Documents/E2E Workspace');
  await expect(fileItem(explorer, 'restored.txt')).toBeVisible();
  await goToFolder(explorer, '/Documents');
  await expect(fileItem(explorer, 'original.txt')).toBeVisible();
});

test('Notepad saves a file, reopens through Explorer and protects unsaved changes', async ({
  page,
}) => {
  await boot(page);
  await closeWelcome(page);
  let notepad = await launchApp(page, 'notepad');
  const text = 'BROwOS — реальные файлы\nПроверка UTF-8 и сохранения после перезагрузки.';
  await notepad.getByRole('textbox', { name: 'Текст документа' }).fill(text);
  await notepad.getByRole('textbox', { name: 'Текст документа' }).press('Control+s');
  await saveDialog(page, 'acceptance-note.txt');
  await expect(notepad).toHaveAttribute('aria-label', /acceptance-note.txt/);
  await notepad.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(notepad).not.toBeVisible();
  const explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Documents');
  await fileItem(explorer, 'acceptance-note.txt').dblclick();
  notepad = page.getByTestId('window-notepad').last();
  await expect(notepad.getByRole('textbox', { name: 'Текст документа' })).toHaveValue(text);
  await notepad.getByRole('textbox', { name: 'Текст документа' }).fill(`${text}\nНе сохранено`);
  page.once('dialog', (dialog) => dialog.dismiss());
  await notepad.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(notepad).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await notepad.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(notepad).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeVisible();
  const reopenedExplorer = await launchApp(page, 'explorer');
  await goToFolder(reopenedExplorer, '/Documents');
  await fileItem(reopenedExplorer, 'acceptance-note.txt').dblclick();
  await expect(
    page.getByTestId('window-notepad').last().getByRole('textbox', { name: 'Текст документа' }),
  ).toHaveValue(text);
});

test('imports and downloads byte-preserving user files through Explorer', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Downloads');
  const contents = Buffer.from('User file\nСтрока два\n', 'utf8');
  await explorer
    .getByLabel('Импортировать файлы')
    .setInputFiles({ name: 'imported.txt', mimeType: 'text/plain', buffer: contents });
  const imported = fileItem(explorer, 'imported.txt');
  await expect(imported).toBeVisible();
  await imported.click();
  const downloadEvent = page.waitForEvent('download');
  await explorer.getByRole('button', { name: 'Скачать', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('imported.txt');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(contents);
});
