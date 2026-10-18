import type { AppManifest } from '@browos/sdk';

export const applications: AppManifest[] = [
  {
    id: 'explorer',
    title: 'Проводник',
    description: 'Ваши файлы и папки',
    icon: 'folder',
    color: '#edb846',
    defaultSize: { width: 850, height: 540 },
  },
  {
    id: 'browser',
    title: 'BROwser',
    description: 'Интернет в вашем рабочем столе',
    icon: 'browser',
    color: '#16a7cc',
    defaultSize: { width: 1000, height: 650 },
  },
  {
    id: 'notepad',
    title: 'Блокнот',
    description: 'Идеи, заметки и тексты',
    icon: 'notepad',
    color: '#47b2df',
    defaultSize: { width: 720, height: 510 },
    extensions: [
      'txt',
      'md',
      'json',
      'csv',
      'js',
      'ts',
      'css',
      'html',
      'xml',
      'log',
      'yaml',
      'yml',
    ],
  },
  {
    id: 'calculator',
    title: 'Калькулятор',
    description: 'Простые и сложные вычисления',
    icon: 'calculator',
    color: '#6885a0',
    defaultSize: { width: 340, height: 510 },
  },
  {
    id: 'paint',
    title: 'Paint',
    description: 'Холст для ваших идей',
    icon: 'paint',
    color: '#ef7d66',
    defaultSize: { width: 880, height: 570 },
  },
  {
    id: 'photos',
    title: 'Фотографии',
    description: 'Смотрите, приближайте, поворачивайте',
    icon: 'photos',
    color: '#876bda',
    defaultSize: { width: 800, height: 550 },
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  },
  {
    id: 'media-player',
    title: 'Медиаплеер',
    description: 'Ваша музыка и видео',
    icon: 'media',
    color: '#e78b25',
    defaultSize: { width: 760, height: 500 },
    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'flac', 'aac'],
  },
  {
    id: 'terminal',
    title: 'Терминал',
    description: 'Команды виртуальной системы',
    icon: 'terminal',
    color: '#3f4f61',
    defaultSize: { width: 760, height: 480 },
  },
  {
    id: 'settings',
    title: 'Параметры',
    description: 'Сделайте BROwOS своим',
    icon: 'settings',
    color: '#70859b',
    defaultSize: { width: 880, height: 580 },
    singleton: true,
  },
  {
    id: 'task-manager',
    title: 'Диспетчер задач',
    description: 'Открытые приложения',
    icon: 'chart',
    color: '#58a6bf',
    defaultSize: { width: 650, height: 430 },
    singleton: true,
  },
  {
    id: 'welcome',
    title: 'Знакомство с BROwOS',
    description: 'Начните здесь',
    icon: 'logo',
    color: '#0078d4',
    defaultSize: { width: 850, height: 550 },
    singleton: true,
  },
];
export function findApp(id: string): AppManifest | undefined {
  return applications.find((app) => app.id === id);
}
export function appForFile(name: string, mime = ''): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (mime.startsWith('image/')) return 'photos';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media-player';
  return applications.find((a) => a.extensions?.includes(ext ?? ''))?.id ?? 'notepad';
}
