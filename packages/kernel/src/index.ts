export interface SystemSettings {
  username: string;
  accent: string;
  wallpaper: 'azure' | 'midnight' | 'sunset' | 'forest';
  theme: 'light' | 'dark';
  clock24: boolean;
  reduceMotion: boolean;
  restoreSession: boolean;
  showSeconds: boolean;
}
export const defaultSettings: SystemSettings = {
  username: 'Пользователь',
  accent: '#0078d4',
  wallpaper: 'azure',
  theme: 'light',
  clock24: true,
  reduceMotion: false,
  restoreSession: true,
  showSeconds: false,
};
export function loadSettings(storage: Pick<Storage, 'getItem'>): SystemSettings {
  try {
    const raw: unknown = JSON.parse(storage.getItem('browos:settings') ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...defaultSettings };
    const s = raw as Record<string, unknown>;
    return {
      username:
        typeof s.username === 'string' && s.username.trim()
          ? s.username.trim().slice(0, 40)
          : defaultSettings.username,
      accent:
        typeof s.accent === 'string' && /^#[\da-f]{6}$/i.test(s.accent)
          ? s.accent
          : defaultSettings.accent,
      wallpaper:
        typeof s.wallpaper === 'string' &&
        ['azure', 'midnight', 'sunset', 'forest'].includes(s.wallpaper)
          ? (s.wallpaper as SystemSettings['wallpaper'])
          : 'azure',
      theme: s.theme === 'dark' ? 'dark' : 'light',
      clock24: s.clock24 !== false,
      reduceMotion: s.reduceMotion === true,
      restoreSession: s.restoreSession !== false,
      showSeconds: s.showSeconds === true,
    };
  } catch {
    return { ...defaultSettings };
  }
}
export function storeSettings(settings: SystemSettings, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem('browos:settings', JSON.stringify(settings));
}
export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  kind: 'info' | 'success' | 'error';
  time: number;
}
