import { describe, expect, it } from 'vitest';
import {
  clampBounds,
  initialWindowState,
  restoreWindowSession,
  visibleBounds,
  windowReducer,
  type Bounds,
  type DesktopWindow,
  type WindowAction,
  type WindowState,
} from '../../packages/window-manager/src/index';

function window(id: string, patch: Partial<DesktopWindow> = {}): DesktopWindow {
  return {
    id,
    appId: 'notepad',
    title: `Document ${id}`,
    x: 80,
    y: 60,
    width: 640,
    height: 420,
    zIndex: 1,
    minimized: false,
    maximized: false,
    snap: 'none',
    desktop: 0,
    openedAt: 1000,
    ...patch,
  };
}

const reduce = (state: WindowState, ...actions: WindowAction[]): WindowState =>
  actions.reduce(windowReducer, state);

describe('window lifetime and focus', () => {
  it('opens, focuses, minimizes and closes windows without losing surviving applications', () => {
    let state = reduce(
      initialWindowState,
      { type: 'open', window: window('a') },
      { type: 'open', window: window('b') },
      { type: 'open', window: window('c') },
    );
    expect(state.activeId).toBe('c');
    const ids = state.windows.map((win) => win.id);
    state = windowReducer(state, { type: 'focus', id: 'a' });
    expect(state.windows.map((win) => win.id)).toEqual(ids);
    expect(state.activeId).toBe('a');
    expect(state.windows.find((win) => win.id === 'a')!.zIndex).toBeGreaterThan(
      state.windows.find((win) => win.id === 'c')!.zIndex,
    );
    state = windowReducer(state, { type: 'minimize', id: 'a' });
    expect(state.activeId).toBe('c');
    expect(state.windows.find((win) => win.id === 'a')!.minimized).toBe(true);
    state = windowReducer(state, { type: 'close', id: 'c' });
    expect(state.activeId).toBe('b');
    expect(state.windows).toHaveLength(2);
    state = reduce(state, { type: 'close', id: 'b' }, { type: 'focus', id: 'a' });
    expect(state.activeId).toBe('a');
    expect(state.windows[0].minimized).toBe(false);
    state = windowReducer(state, { type: 'close', id: 'a' });
    expect(state.windows).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(initialWindowState.windows).toEqual([]);
  });

  it('does not choose focus in response to background title or bounds changes', () => {
    const state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [
        window('a'),
        window('b', { zIndex: 2 }),
        window('remote', { desktop: 1, zIndex: 9 }),
      ],
    };
    for (const action of [
      { type: 'title', id: 'b', title: 'Background save finished' },
      { type: 'bounds', id: 'b', bounds: { x: 40, y: 50, width: 800, height: 500 } },
      { type: 'title', id: 'remote', title: 'Hidden window title' },
      { type: 'minimize', id: 'remote' },
    ] satisfies WindowAction[]) {
      const next = windowReducer(state, action);
      expect(next.activeId).toBe('a');
      expect(next.desktop).toBe(0);
    }
  });

  it('preserves state identity for absent windows and actual no-op metadata updates', () => {
    const state: WindowState = { desktop: 0, activeId: 'a', windows: [window('a')] };
    expect(windowReducer(state, { type: 'close', id: 'missing' })).toBe(state);
    expect(windowReducer(state, { type: 'title', id: 'a', title: 'Document a' })).toBe(state);
    expect(
      windowReducer(state, {
        type: 'bounds',
        id: 'a',
        bounds: { x: 80, y: 60, width: 640, height: 420 },
      }),
    ).toBe(state);
    expect(windowReducer(state, { type: 'desktop', desktop: 0 })).toBe(state);
    expect(windowReducer(state, { type: 'focus', id: 'a' })).toBe(state);
  });

  it('selects a visible window on the same desktop and switches desktop when explicitly focusing another', () => {
    let state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [
        window('a', { zIndex: 4 }),
        window('b', { zIndex: 2 }),
        window('remote', { desktop: 1, zIndex: 9 }),
      ],
    };
    state = windowReducer(state, { type: 'move-desktop', id: 'a', desktop: 1 });
    expect(state.activeId).toBe('b');
    expect(state.desktop).toBe(0);
    state = windowReducer(state, { type: 'focus', id: 'a' });
    expect(state.activeId).toBe('a');
    expect(state.desktop).toBe(1);
    state = windowReducer(state, { type: 'desktop', desktop: 0 });
    expect(state.activeId).toBe('b');
  });

  it('does not duplicate window identities or exceed the session window budget', () => {
    let state = windowReducer(initialWindowState, { type: 'open', window: window('a') });
    state = windowReducer(state, { type: 'open', window: window('a', { title: 'Duplicate' }) });
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0].title).toBe('Document a');
    for (let index = 1; index < 40; index += 1)
      state = windowReducer(state, { type: 'open', window: window(`app-${index}`) });
    expect(state.windows).toHaveLength(30);
    expect(state.windows.some((win) => win.id === state.activeId && !win.minimized)).toBe(true);
  });
});

describe('maximize, snapping and desktop visibility', () => {
  it('maximizes above the taskbar and restores the original bounds', () => {
    const original = window('a');
    let state = windowReducer(initialWindowState, { type: 'open', window: original });
    state = windowReducer(state, { type: 'maximize', id: 'a' });
    expect(visibleBounds(state.windows[0], { width: 1280, height: 800 })).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 756,
    });
    state = reduce(state, { type: 'minimize', id: 'a' }, { type: 'maximize', id: 'a' });
    expect(state.windows[0]).toMatchObject({
      x: 80,
      y: 60,
      width: 640,
      height: 420,
      maximized: false,
      minimized: false,
      snap: 'none',
    });
    expect(state.windows[0].restoreBounds).toBeUndefined();
    expect(state.activeId).toBe('a');
  });

  it('keeps current bounds after maximizing, dragging out, resizing and snapping again', () => {
    const restored: Bounds = { x: 140, y: 100, width: 760, height: 460 };
    const resized: Bounds = { ...restored, width: 820, height: 500 };
    let state = reduce(
      initialWindowState,
      { type: 'open', window: window('a') },
      { type: 'maximize', id: 'a' },
      { type: 'bounds', id: 'a', bounds: restored, restore: true },
      { type: 'bounds', id: 'a', bounds: resized },
    );
    expect(state.windows[0].restoreBounds).toBeUndefined();
    state = windowReducer(state, { type: 'snap', id: 'a', side: 'right' });
    expect(state.windows[0].restoreBounds).toEqual(resized);
    expect(visibleBounds(state.windows[0], { width: 1280, height: 800 })).toEqual({
      x: 640,
      y: 0,
      width: 640,
      height: 756,
    });
    state = reduce(state, { type: 'maximize', id: 'a' }, { type: 'maximize', id: 'a' });
    expect(state.windows[0]).toMatchObject(resized);
    expect(state.windows[0].snap).toBe('none');
  });

  it('restores only windows hidden by Show Desktop, retaining independently minimized windows', () => {
    const state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [
        window('a'),
        window('b', { minimized: true, zIndex: 5 }),
        window('remote', { desktop: 1 }),
      ],
    };
    const hidden = windowReducer(state, { type: 'show-desktop' });
    expect(hidden.activeId).toBeNull();
    expect(hidden.windows.find((win) => win.id === 'remote')!.minimized).toBe(false);
    const restored = reduce(hidden, { type: 'show-desktop' }, { type: 'restore-desktop' });
    expect(restored.activeId).toBe('a');
    expect(restored.windows.find((win) => win.id === 'a')!.minimized).toBe(false);
    expect(restored.windows.find((win) => win.id === 'b')!.minimized).toBe(true);
    expect(windowReducer(restored, { type: 'restore-desktop' })).toBe(restored);
  });

  it('keeps independent Show Desktop snapshots when switching desktops', () => {
    let state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [
        window('a'),
        window('b', { minimized: true }),
        window('c', { desktop: 1 }),
        window('d', { desktop: 1, minimized: true }),
      ],
    };
    state = reduce(
      state,
      { type: 'show-desktop' },
      { type: 'desktop', desktop: 1 },
      { type: 'show-desktop' },
      { type: 'desktop', desktop: 0 },
      { type: 'restore-desktop' },
    );
    expect(state.windows.map((win) => [win.id, win.minimized])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
      ['d', true],
    ]);
    state = reduce(state, { type: 'desktop', desktop: 1 }, { type: 'restore-desktop' });
    expect(state.activeId).toBe('c');
    expect(state.windows.find((win) => win.id === 'd')!.minimized).toBe(true);
  });

  it('respects an explicit minimize after a Show Desktop window was reopened', () => {
    let state: WindowState = {
      desktop: 0,
      activeId: 'b',
      windows: [window('a'), window('b', { zIndex: 2 })],
    };
    state = reduce(
      state,
      { type: 'show-desktop' },
      { type: 'focus', id: 'a' },
      { type: 'minimize', id: 'a' },
      { type: 'restore-desktop' },
    );
    expect(state.windows.find((win) => win.id === 'a')!.minimized).toBe(true);
    expect(state.windows.find((win) => win.id === 'b')!.minimized).toBe(false);
    expect(state.activeId).toBe('b');
  });
});

describe('viewport bounds', () => {
  it.each([
    { width: 1280, height: 800 },
    { width: 320, height: 260 },
    { width: 240, height: 180 },
    { width: 80, height: 32 },
    { width: 0, height: 0 },
  ])('keeps restored, maximized and snapped windows within $width × $height', (viewport) => {
    for (const configuration of [
      window('a', { x: 99_999, y: -99_999, width: 99_999, height: 99_999 }),
      window('a', { maximized: true }),
      window('a', { snap: 'left' }),
      window('a', { snap: 'right' }),
    ]) {
      const bounds = visibleBounds(configuration, viewport);
      expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.width).toBeGreaterThanOrEqual(0);
      expect(bounds.height).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(Math.max(0, viewport.height - 44));
    }
  });

  it('normalizes malformed bounds to usable finite geometry', () => {
    expect(
      clampBounds({ x: NaN, y: Infinity, width: -30, height: NaN }, { width: 800, height: 600 }),
    ).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('persisted session validation', () => {
  const known = new Set(['notepad', 'explorer']);

  it('retains Show Desktop restoration over reload while filtering forged window references', () => {
    const state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [window('a'), window('b', { minimized: true }), window('remote', { desktop: 1 })],
    };
    const hidden = windowReducer(state, { type: 'show-desktop' });
    hidden.desktopVisibility![0].ids.push('missing', 'remote');
    const restored = restoreWindowSession(JSON.stringify(hidden), known);
    expect(restored.desktopVisibility![0].ids).toEqual(['a']);
    const visible = windowReducer(restored, { type: 'restore-desktop' });
    expect(visible.windows.find((win) => win.id === 'a')!.minimized).toBe(false);
    expect(visible.windows.find((win) => win.id === 'b')!.minimized).toBe(true);
    expect(visible.activeId).toBe('a');
  });

  it('keeps window stacking bounded throughout a long-running session', () => {
    let state: WindowState = {
      desktop: 0,
      activeId: 'a',
      windows: [window('a'), window('b', { zIndex: 2 })],
    };
    for (let index = 0; index < 2000; index += 1)
      state = windowReducer(state, { type: 'focus', id: index % 2 === 0 ? 'b' : 'a' });
    expect(Math.max(...state.windows.map((win) => win.zIndex))).toBeLessThanOrEqual(
      state.windows.length + 1,
    );
    expect(state.activeId).toBe('a');
  });

  it('restores valid app data, current desktop, active window and restoration geometry', () => {
    const restoreBounds = { x: 25, y: 45, width: 740, height: 480 };
    const state = restoreWindowSession(
      JSON.stringify({
        desktop: 1,
        activeId: 'b',
        windows: [
          window('a'),
          window('b', {
            desktop: 1,
            maximized: true,
            restoreBounds,
            data: { fileId: 'saved-file', token: 'must not restore', html: '<script/>' },
          }),
        ],
      }),
      known,
    );
    expect(state.desktop).toBe(1);
    expect(state.activeId).toBe('b');
    expect(state.windows[1].restoreBounds).toEqual(restoreBounds);
    expect(state.windows[1].data).toEqual({ fileId: 'saved-file' });
    expect(windowReducer(state, { type: 'maximize', id: 'b' }).windows[1]).toMatchObject(
      restoreBounds,
    );
  });

  it('rejects malformed entries, duplicate identities, non-positive geometry and unknown applications', () => {
    const raw = {
      windows: [
        null,
        [],
        window(''),
        window('a', { appId: 'unknown' }),
        window('a'),
        window('a', { title: 'Duplicate' }),
        window('b', { width: -1 }),
        window('c', { height: 0 }),
        { ...window('d'), x: '50' },
        { ...window('e'), zIndex: null },
      ],
    };
    expect(restoreWindowSession(JSON.stringify(raw), known).windows.map((win) => win.id)).toEqual([
      'a',
    ]);
    for (const invalid of [null, '', '{bad', '[]', 'null', '{"windows":{}}'])
      expect(restoreWindowSession(invalid, known)).toEqual(initialWindowState);
  });

  it('rebases extreme z-order values so future focus actions can advance the stacking order', () => {
    let state = restoreWindowSession(
      JSON.stringify({ windows: [window('a', { zIndex: 1e300 }), window('b', { zIndex: 1e299 })] }),
      known,
    );
    expect(state.windows.every((win) => Number.isSafeInteger(win.zIndex) && win.zIndex <= 30)).toBe(
      true,
    );
    state = windowReducer(state, { type: 'focus', id: 'b' });
    expect(state.activeId).toBe('b');
    expect(state.windows.find((win) => win.id === 'b')!.zIndex).toBeGreaterThan(
      state.windows.find((win) => win.id === 'a')!.zIndex,
    );
  });

  it('limits titles, geometry, app data and invalid lifetime timestamps from stored JSON', () => {
    const raw = JSON.stringify({
      windows: [
        window('a', {
          title: 'x'.repeat(500),
          width: 1e300,
          x: 1e300,
          openedAt: 1000,
          snap: 'left',
          maximized: true,
          data: { fileId: { dangerous: true }, folderId: 'documents' },
        }),
      ],
    }).replace('"openedAt":1000', '"openedAt":1e400');
    const restored = restoreWindowSession(raw, known).windows[0];
    expect(restored.title).toHaveLength(200);
    expect(restored.width).toBeLessThanOrEqual(16_384);
    expect(restored.x).toBeLessThanOrEqual(16_384);
    expect(Number.isFinite(restored.openedAt)).toBe(true);
    expect(restored.openedAt).toBeLessThanOrEqual(Date.now());
    expect(restored.data).toEqual({ folderId: 'documents' });
    expect(restored.snap).toBe('none');
  });

  it('caps restored sessions at 30 windows and never activates a hidden or minimized window', () => {
    const state = restoreWindowSession(
      JSON.stringify({
        desktop: 0,
        activeId: 'hidden',
        windows: [
          window('hidden', { desktop: 1 }),
          window('minimized', { minimized: true }),
          ...Array.from({ length: 40 }, (_, index) =>
            window(`app-${index}`, { zIndex: index + 10 }),
          ),
        ],
      }),
      known,
    );
    expect(state.windows).toHaveLength(30);
    expect(
      state.windows.some(
        (win) => win.id === state.activeId && win.desktop === state.desktop && !win.minimized,
      ),
    ).toBe(true);
  });
});
