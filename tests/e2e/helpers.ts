import { expect, type Locator, type Page } from '@playwright/test';

export async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeVisible();
}

export async function closeWelcome(page: Page) {
  const welcome = page.getByTestId('window-welcome');
  if (await welcome.isVisible()) {
    await welcome.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
}

export async function launchApp(page: Page, appId: string): Promise<Locator> {
  const search = page.getByRole('textbox', { name: 'Поиск приложений и файлов' });
  await search.fill(appId);
  await search.press('Enter');
  const app = page.getByTestId(`window-${appId}`).last();
  await expect(app).toBeVisible();
  return app;
}

export function fileItem(explorer: Locator, name: string) {
  return explorer.getByTestId('file-item').filter({
    has: explorer.page().locator('.file-name', {
      hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    }),
  });
}

export async function goToFolder(explorer: Locator, path: string) {
  const address = explorer.getByRole('textbox', { name: 'Путь к папке' });
  await address.fill(path);
  await address.press('Enter');
  await expect(address).toHaveValue(path);
}

export async function createItem(explorer: Locator, kind: 'folder' | 'file', name: string) {
  await explorer
    .getByRole('button', { name: kind === 'folder' ? 'Новая папка' : 'Новый файл', exact: true })
    .click();
  const dialog = explorer.getByRole('dialog', { name: 'Создать элемент' });
  await dialog.getByRole('textbox', { name: 'Имя элемента' }).fill(name);
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(fileItem(explorer, name)).toBeVisible();
}

export async function saveDialog(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Сохранить файл', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Имя файла' }).fill(name);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export async function terminalCommand(terminal: Locator, command: string) {
  const input = terminal.getByRole('textbox', { name: 'Команда терминала' });
  await expect(input).toBeEnabled();
  await input.fill(command);
  await input.press('Enter');
  await expect(
    terminal.locator('.browos-terminal-entry').last().locator('.browos-terminal-command'),
  ).toContainText(command);
  await expect(input).toBeEnabled();
  return terminal.locator('.browos-terminal-entry').last();
}
