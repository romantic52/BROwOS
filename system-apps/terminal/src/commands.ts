import type { DesktopServices } from '@browos/sdk';

/** Parse quoted arguments without shell expansion, evaluation, or subprocesses. */
export function parseCommand(source: string): string[] {
  if (source.length > 16_384) throw new Error('Команда слишком длинная');
  const args: string[] = [];
  let value = '';
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (
      character === '\\' &&
      next &&
      (next === '\\' ||
        next === quote ||
        (!quote && (next === '"' || next === "'" || /\s/.test(next))))
    ) {
      value += next;
      index += 1;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else value += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(value);
        value = '';
        started = false;
      }
    } else {
      value += character;
      started = true;
    }
  }
  if (quote) throw new Error('Не закрыты кавычки');
  if (started) args.push(value);
  return args;
}

export function absolutePath(path: string, cwdPath: string): string {
  let normalized = path.replaceAll('\\', '/').replace(/^c:/i, '');
  if (normalized === '~' || normalized.startsWith('~/'))
    normalized = `/Documents${normalized.slice(1)}`;
  if (!normalized.startsWith('/')) normalized = `${cwdPath}/${normalized}`;
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export interface TerminalContext {
  fs: DesktopServices['fs'];
  cwd: string;
  openFile: DesktopServices['openFile'];
  openApp: DesktopServices['openApp'];
}

export interface CommandResult {
  text: string;
  cwd?: string;
  clear?: boolean;
}

const HELP = `BROwOS Terminal — команды виртуальной файловой системы

help                       Эта справка
ls [-l] [путь]              Содержимое папки
cd [путь]                   Перейти в папку; без пути — /Documents
pwd                         Показать текущий путь
cat <файл>                  Прочитать UTF-8 текст (до 1 МБ)
mkdir <путь>                Создать папку
touch <файл>                Создать пустой файл; существующий не стирается
write <файл> "текст"        Записать текст; \\n обозначает новую строку
append <файл> "текст"       Дописать текст в конец
cp <источник> <папка>       Скопировать файл или дерево папок
mv <источник> <папка>       Переместить в существующую папку
rename <путь> "новое имя"   Переименовать файл или папку
rm <путь>                  Переместить в корзину
trash                      Корзина и идентификаторы для восстановления
restore <id>               Восстановить объект из корзины
open <путь>                Открыть файл или папку в приложении
open app:<id>              Запустить calculator, notepad, paint и т. д.
echo <текст>               Вывести текст
date                       Текущие дата и время
whoami                     Локальный пользователь BROwOS
clear                      Очистить терминал

Пути: /Documents, C:\\Documents, ../Pictures; ~ = /Documents.
Имена с пробелами заключайте в кавычки. ↑/↓ — история команд.
Это виртуальная консоль: здесь нет ОС-хоста, bash, npm или сети.`;

export async function runCommand(source: string, context: TerminalContext): Promise<CommandResult> {
  const [rawCommand = '', ...args] = parseCommand(source);
  const command = rawCommand.toLowerCase();
  const { fs } = context;
  const current = fs.get(context.cwd);
  const cwd = current?.kind === 'directory' && !current.trashed ? context.cwd : 'documents';
  const cwdPath = fs.path(cwd);
  function requireArgs(min: number, max = min) {
    if (args.length < min || args.length > max)
      throw new Error(`Проверьте аргументы ${command}. Введите help для справки.`);
  }
  function existing(path: string) {
    const node = fs.resolve(absolutePath(path, cwdPath));
    if (!node || node.trashed) throw new Error(`Путь не найден: ${path}`);
    return node;
  }
  function directory(path: string) {
    const node = existing(path);
    if (node.kind !== 'directory') throw new Error(`Это не папка: ${path}`);
    return node;
  }
  function destination(path: string) {
    const absolute = absolutePath(path, cwdPath);
    const slash = absolute.lastIndexOf('/');
    const name = absolute.slice(slash + 1);
    if (!name) throw new Error('Укажите имя нового файла или папки');
    return { parent: directory(absolute.slice(0, slash) || '/'), name };
  }

  if (!command) return { text: '' };
  if (command === 'help') return { text: HELP };
  if (command === 'clear' || command === 'cls') return { text: '', clear: true };
  if (command === 'pwd') return { text: cwdPath };
  if (command === 'whoami')
    return { text: 'guest — локальный пользователь BROwOS (данные хранятся в этом браузере)' };
  if (command === 'date')
    return { text: new Date().toLocaleString('ru-RU', { dateStyle: 'full', timeStyle: 'long' }) };
  if (command === 'echo') return { text: args.join(' ') };
  if (command === 'cd') {
    requireArgs(0, 1);
    return { text: '', cwd: directory(args[0] ?? '/Documents').id };
  }
  if (command === 'ls' || command === 'dir') {
    const long = args.includes('-l');
    const paths = args.filter((argument) => argument !== '-l');
    if (paths.length > 1 || paths.some((path) => path.startsWith('-')))
      throw new Error('Использование: ls [-l] [путь]');
    const folder = directory(paths[0] ?? cwdPath);
    const nodes = fs.list(folder.id);
    if (!nodes.length) return { text: '(папка пуста)' };
    return {
      text: nodes
        .map((node) =>
          long
            ? `${node.kind === 'directory' ? 'd' : '-'}  ${String(node.size).padStart(9)} B  ${new Date(node.updatedAt).toLocaleString('ru-RU')}  ${node.name}${node.kind === 'directory' ? '/' : ''}`
            : `${node.name}${node.kind === 'directory' ? '/' : ''}`,
        )
        .join('\n'),
    };
  }
  if (command === 'cat') {
    requireArgs(1);
    const node = existing(args[0]!);
    if (node.kind !== 'file') throw new Error('cat читает только файлы');
    if (node.size > 1_048_576)
      throw new Error('Файл больше 1 МБ. Откройте его в Блокноте: open "путь"');
    return { text: await fs.readText(node.id) };
  }
  if (command === 'mkdir') {
    requireArgs(1);
    const { parent, name } = destination(args[0]!);
    const node = await fs.mkdir(parent.id, name);
    return { text: `Создана папка ${fs.path(node.id)}` };
  }
  if (command === 'touch' || command === 'write' || command === 'append') {
    requireArgs(command === 'touch' ? 1 : 2, command === 'touch' ? 1 : 500);
    const node = fs.resolve(absolutePath(args[0]!, cwdPath));
    if (node?.kind === 'directory') throw new Error('Указанный путь — папка');
    if (command === 'touch' && node)
      return { text: `Файл уже существует: ${fs.path(node.id)} (содержимое сохранено)` };
    let content = args.slice(1).join(' ').replaceAll('\\n', '\n');
    // Append is a read-modify-write operation. An intervening save must fail with a
    // conflict instead of silently replacing the other application's newer contents.
    const expectedUpdatedAt = command === 'append' && node ? node.updatedAt : undefined;
    if (command === 'append' && node) content = (await fs.readText(node.id)) + content;
    const { parent, name } = destination(args[0]!);
    const written = node
      ? await fs.updateFile(node.id, content, 'text/plain', expectedUpdatedAt)
      : await fs.writeFile(parent.id, name, content, 'text/plain');
    return { text: `Записано ${written.size} B → ${fs.path(written.id)}` };
  }
  if (command === 'cp' || command === 'mv') {
    requireArgs(2);
    const sourceNode = existing(args[0]!);
    const target = directory(args[1]!);
    const result =
      command === 'cp'
        ? await fs.copy(sourceNode.id, target.id)
        : await fs.move(sourceNode.id, target.id);
    return { text: `${command === 'cp' ? 'Скопировано' : 'Перемещено'} → ${fs.path(result.id)}` };
  }
  if (command === 'rename') {
    requireArgs(2);
    const result = await fs.rename(existing(args[0]!).id, args[1]!);
    return { text: `Переименовано → ${fs.path(result.id)}` };
  }
  if (command === 'rm' || command === 'del') {
    requireArgs(1);
    const node = existing(args[0]!);
    await fs.trash(node.id);
    const active = fs.get(cwd);
    return {
      text: `В корзине: ${node.name}\nВосстановление: restore ${node.id}`,
      ...(active?.trashed ? { cwd: 'documents' } : {}),
    };
  }
  if (command === 'trash') {
    requireArgs(0);
    const nodes = fs.listTrash();
    return {
      text: nodes.length
        ? nodes
            .map((node) => `${node.id}  ${node.name}${node.kind === 'directory' ? '/' : ''}`)
            .join('\n')
        : '(корзина пуста)',
    };
  }
  if (command === 'restore') {
    requireArgs(1);
    const node = fs.get(args[0]!);
    if (!node?.trashed)
      throw new Error('Объект с этим ID отсутствует в корзине. Введите trash для списка.');
    const restored = await fs.restore(node.id);
    return { text: `Восстановлено → ${fs.path(restored.id)}` };
  }
  if (command === 'open') {
    requireArgs(1);
    const path = args[0]!;
    if (path.startsWith('app:')) {
      const appId = path.slice(4);
      const apps = [
        'explorer',
        'browser',
        'notepad',
        'calculator',
        'paint',
        'terminal',
        'photos',
        'media-player',
        'settings',
        'task-manager',
      ];
      if (!apps.includes(appId))
        throw new Error(`Приложение не найдено. Доступно: ${apps.join(', ')}`);
      context.openApp(appId);
    } else {
      const node = existing(path);
      if (node.kind === 'directory') context.openApp('explorer', { folderId: node.id });
      else context.openFile(node.id);
    }
    return { text: `Открыто: ${path}` };
  }
  throw new Error(
    `Неизвестная команда: ${rawCommand}. Введите help. Здесь доступны только команды BROwOS.`,
  );
}
