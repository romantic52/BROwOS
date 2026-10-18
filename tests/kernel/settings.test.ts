import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, storeSettings } from '../../packages/kernel/src/index';

function storage(value: unknown) {
  return { getItem: vi.fn(() => JSON.stringify(value)) };
}

describe('persistent system settings', () => {
  it('round-trips supported appearance, identity and session preferences', () => {
    const saved = {
      ...defaultSettings,
      username: 'Boss',
      accent: '#1AbC09',
      wallpaper: 'forest' as const,
      theme: 'dark' as const,
      clock24: false,
      restoreSession: false,
      reduceMotion: true,
      showSeconds: true,
    };
    const target = { setItem: vi.fn() };
    storeSettings(saved, target);
    expect(target.setItem).toHaveBeenCalledWith('browos:settings', JSON.stringify(saved));
    expect(loadSettings(storage(saved))).toEqual(saved);
  });

  it('normalizes usernames and rejects malformed colors and non-string wallpaper values', () => {
    const loaded = loadSettings(
      storage({
        username: '  Boss  ',
        accent: 'url(javascript:alert(1))',
        wallpaper: ['forest'],
        theme: ['dark'],
      }),
    );
    expect(loaded.username).toBe('Boss');
    expect(loaded.accent).toBe(defaultSettings.accent);
    expect(loaded.wallpaper).toBe(defaultSettings.wallpaper);
    expect(loaded.theme).toBe('light');
    expect(loadSettings(storage({ username: 'x'.repeat(100) })).username).toHaveLength(40);
    expect(loadSettings(storage({ username: '   ' })).username).toBe(defaultSettings.username);
  });

  it('accepts booleans strictly and leaves defaults unchanged when storage is malformed', () => {
    const initial = { ...defaultSettings };
    const malformed = loadSettings(
      storage({
        clock24: 'false',
        reduceMotion: 'true',
        restoreSession: 0,
        showSeconds: 1,
        wallpaper: { value: 'forest' },
      }),
    );
    expect(malformed).toEqual(defaultSettings);
    malformed.username = 'Changed only this return value';
    expect(defaultSettings).toEqual(initial);
  });

  it('returns safe defaults when storage is unavailable or JSON is invalid', () => {
    expect(
      loadSettings({
        getItem: () => {
          throw new DOMException('Unavailable', 'SecurityError');
        },
      }),
    ).toEqual(defaultSettings);
    expect(loadSettings({ getItem: () => '{corrupt' })).toEqual(defaultSettings);
    expect(loadSettings({ getItem: () => null })).toEqual(defaultSettings);
    expect(loadSettings(storage(null))).toEqual(defaultSettings);
  });

  it('reports a failed persistence write to the caller instead of claiming settings were saved', () => {
    expect(() =>
      storeSettings(defaultSettings, {
        setItem: () => {
          throw new DOMException('Full', 'QuotaExceededError');
        },
      }),
    ).toThrow('Full');
  });
});
