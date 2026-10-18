import { expect, test } from '@playwright/test';
import {
  boot,
  closeWelcome,
  fileItem,
  goToFolder,
  launchApp,
  saveDialog,
  terminalCommand,
} from './helpers';

test('Calculator evaluates keyboard expressions and rejects executable input', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const calculator = await launchApp(page, 'calculator');
  const expression = calculator.getByRole('textbox', { name: 'Выражение' });
  await expression.fill('(12 + 8) * 5 - 25%');
  await expression.press('Enter');
  await expect(expression).toHaveValue('99.75');
  await expression.fill('1 / 0');
  await expression.press('Enter');
  await expect(calculator.getByRole('status')).toContainText('Деление на ноль невозможно');
  await expression.fill('globalThis.alert(1)');
  await expression.press('Enter');
  await expect(expression).toHaveAttribute('aria-invalid', 'true');
  await calculator.getByRole('button', { name: 'Очистить всё' }).click();
  await calculator.getByRole('button', { name: '7', exact: true }).click();
  await calculator.getByRole('button', { name: '+', exact: true }).click();
  await calculator.getByRole('button', { name: '3', exact: true }).click();
  await calculator.getByRole('button', { name: 'Вычислить' }).click();
  await expect(expression).toHaveValue('10');
});

test('Paint draws real pixels, undoes, redoes, saves PNG and opens it in Photos', async ({
  page,
}) => {
  await boot(page);
  await closeWelcome(page);
  const paint = await launchApp(page, 'paint');
  const canvas = paint.getByTestId('paint-canvas');
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
      ),
    )
    .toBe(255);
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, {
    steps: 15,
  });
  await page.mouse.up();
  const drawn = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(drawn).not.toBe(original);
  await paint.getByRole('button', { name: '↶ Отменить' }).click();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await paint.getByRole('button', { name: '↷ Повторить' }).click();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(drawn);
  await paint.getByRole('button', { name: 'Сохранить PNG', exact: true }).click();
  await saveDialog(page, 'e2e-drawing.png');
  await paint.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Pictures');
  await fileItem(explorer, 'e2e-drawing.png').dblclick();
  const photos = page.getByTestId('window-photos').last();
  const image = photos.getByRole('img', { name: 'e2e-drawing.png' });
  await expect(image).toBeVisible();
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(960);
  await photos.getByRole('button', { name: 'Увеличить изображение' }).click();
  await expect(photos.getByRole('button', { name: '125%' })).toBeVisible();
  await photos.getByRole('button', { name: '↻ Повернуть' }).click();
  await expect(image).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
});

test('Terminal commands create and edit files that open in Notepad', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const terminal = await launchApp(page, 'terminal');
  await terminalCommand(terminal, 'mkdir acceptance');
  await terminalCommand(terminal, 'cd acceptance');
  await terminalCommand(terminal, 'write "note.txt" "Hello BROwOS"');
  const read = await terminalCommand(terminal, 'cat note.txt');
  await expect(read.locator('pre')).toHaveText('Hello BROwOS');
  await terminalCommand(terminal, 'cp note.txt /Desktop');
  await terminalCommand(terminal, 'rm note.txt');
  const trash = await terminalCommand(terminal, 'trash');
  await expect(trash).toContainText('note.txt');
  const host = await terminalCommand(terminal, 'npm install unavailable');
  await expect(host.locator('pre')).toHaveClass(/browos-terminal-error/);
  await terminalCommand(terminal, 'open /Desktop/note.txt');
  const notepad = page.getByTestId('window-notepad').last();
  await expect(notepad.getByRole('textbox', { name: 'Текст документа' })).toHaveValue(
    'Hello BROwOS',
  );
});

test('Media Player decodes and plays an imported PCM WAV file', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const explorer = await launchApp(page, 'explorer');
  await goToFolder(explorer, '/Music');
  // Original, silent PCM fixture: two seconds, mono, 16-bit, 48 kHz.
  const wav = Buffer.alloc(44 + 48_000 * 2 * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48_000, 24);
  wav.writeUInt32LE(96_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await explorer
    .getByLabel('Импортировать файлы')
    .setInputFiles({ name: 'acceptance-audio.wav', mimeType: 'audio/wav', buffer: wav });
  await fileItem(explorer, 'acceptance-audio.wav').dblclick();
  const player = page.getByTestId('window-media-player').last();
  const audio = player.locator('audio');
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBe(2);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect(player).toContainText('Сейчас играет');
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
});
