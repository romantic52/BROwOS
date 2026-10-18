export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DesktopWindow extends Bounds {
  id: string;
  appId: string;
  title: string;
  data?: Record<string, unknown>;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  snap: 'none' | 'left' | 'right';
  restoreBounds?: Bounds;
  desktop: number;
  openedAt: number;
}
export interface DesktopVisibilitySnapshot {
  ids: string[];
  activeId: string | null;
}
export interface WindowState {
  windows: DesktopWindow[];
  activeId: string | null;
  desktop: number;
  desktopVisibility?: Record<number, DesktopVisibilitySnapshot>;
}
export type WindowAction =
  | { type: 'open'; window: DesktopWindow }
  | { type: 'focus' | 'close' | 'minimize' | 'maximize'; id: string }
  | { type: 'title'; id: string; title: string }
  | { type: 'bounds'; id: string; bounds: Bounds; restore?: boolean }
  | { type: 'snap'; id: string; side: 'left' | 'right' }
  | { type: 'desktop'; desktop: number }
  | { type: 'move-desktop'; id: string; desktop: number }
  | { type: 'show-desktop' }
  | { type: 'restore-desktop' };

export const initialWindowState: WindowState = { windows: [], activeId: null, desktop: 0 };
const TASKBAR_HEIGHT = 44;
const MAX_WINDOWS = 30;
const MAX_SAVED_DIMENSION = 16_384;
const desktopId = (value: unknown): number => (value === 1 ? 1 : 0);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const pickBounds = (window: Bounds): Bounds => ({
  x: window.x,
  y: window.y,
  width: window.width,
  height: window.height,
});

function workArea(viewport: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(0, finite(viewport.width) ? viewport.width : 0),
    height: Math.max(0, (finite(viewport.height) ? viewport.height : 0) - TASKBAR_HEIGHT),
  };
}

export function clampBounds(bounds: Bounds, viewport: { width: number; height: number }): Bounds {
  const area = workArea(viewport);
  const width = Math.min(Math.max(300, finite(bounds.width) ? bounds.width : 300), area.width);
  const height = Math.min(Math.max(200, finite(bounds.height) ? bounds.height : 200), area.height);
  return {
    width,
    height,
    x: Math.max(0, Math.min(finite(bounds.x) ? bounds.x : 0, area.width - width)),
    y: Math.max(0, Math.min(finite(bounds.y) ? bounds.y : 0, area.height - height)),
  };
}

export function visibleBounds(
  win: DesktopWindow,
  viewport: { width: number; height: number },
): Bounds {
  const area = workArea(viewport);
  if (win.maximized) return { x: 0, y: 0, ...area };
  if (win.snap !== 'none')
    return {
      x: win.snap === 'left' ? 0 : area.width / 2,
      y: 0,
      width: area.width / 2,
      height: area.height,
    };
  return clampBounds(win, viewport);
}

function nextFocus(windows: DesktopWindow[], desktop: number): string | null {
  let top: DesktopWindow | undefined;
  for (const win of windows) {
    if (win.desktop === desktop && !win.minimized && (!top || win.zIndex > top.zIndex)) top = win;
  }
  return top?.id ?? null;
}

/** Compact untrusted or very old z-order values, retaining their relative order. */
function rankedWindows(windows: DesktopWindow[]): DesktopWindow[] {
  const ranks = new Map(
    [...windows].sort((a, b) => a.zIndex - b.zIndex).map((win, index) => [win.id, index + 1]),
  );
  return windows.map((win) => ({ ...win, zIndex: ranks.get(win.id) ?? 1 }));
}

function forgetVisibility(state: WindowState, id: string): WindowState {
  if (!state.desktopVisibility) return state;
  const snapshots = { ...state.desktopVisibility };
  let changed = false;
  for (const [desktop, snapshot] of Object.entries(snapshots)) {
    if (!snapshot.ids.includes(id)) continue;
    changed = true;
    const ids = snapshot.ids.filter((candidate) => candidate !== id);
    if (ids.length)
      snapshots[Number(desktop)] = {
        ids,
        activeId: snapshot.activeId === id ? null : snapshot.activeId,
      };
    else delete snapshots[Number(desktop)];
  }
  return changed ? { ...state, desktopVisibility: snapshots } : state;
}

function activate(
  state: WindowState,
  id: string,
  update: (win: DesktopWindow) => DesktopWindow,
): WindowState {
  const cleaned = forgetVisibility(state, id);
  // Keep application windows in a bounded layer even after thousands of focus changes;
  // an old session must never grow above taskbars, menus, or modal dialogs.
  const windows = rankedWindows(state.windows);
  const top = Math.max(0, ...windows.map((win) => win.zIndex)) + 1;
  const target = windows.find((win) => win.id === id)!;
  const changed = { ...update(target), minimized: false, zIndex: top };
  return {
    ...cleaned,
    windows: windows.map((win) => (win.id === id ? changed : win)),
    activeId: id,
    desktop: target.desktop,
  };
}

function replace(state: WindowState, target: DesktopWindow): WindowState {
  return { ...state, windows: state.windows.map((win) => (win.id === target.id ? target : win)) };
}

export function windowReducer(state: WindowState, action: WindowAction): WindowState {
  if (action.type === 'open') {
    if (state.windows.some((win) => win.id === action.window.id))
      return windowReducer(state, { type: 'focus', id: action.window.id });
    if (state.windows.length >= MAX_WINDOWS) return state;
    const window = {
      ...action.window,
      desktop: desktopId(action.window.desktop),
      minimized: false,
    };
    return activate({ ...state, windows: [...state.windows, window] }, window.id, (win) => win);
  }
  if (action.type === 'desktop') {
    const desktop = desktopId(action.desktop);
    if (desktop === state.desktop) return state;
    return { ...state, desktop, activeId: nextFocus(state.windows, desktop) };
  }
  if (action.type === 'show-desktop') {
    const visible = state.windows.filter((win) => win.desktop === state.desktop && !win.minimized);
    if (!visible.length) return state;
    const previous = state.desktopVisibility?.[state.desktop];
    const snapshot = {
      ids: [...new Set([...(previous?.ids ?? []), ...visible.map((win) => win.id)])],
      activeId: state.activeId ?? previous?.activeId ?? null,
    };
    return {
      ...state,
      activeId: null,
      desktopVisibility: { ...state.desktopVisibility, [state.desktop]: snapshot },
      windows: state.windows.map((win) =>
        win.desktop === state.desktop && !win.minimized ? { ...win, minimized: true } : win,
      ),
    };
  }
  if (action.type === 'restore-desktop') {
    const snapshot = state.desktopVisibility?.[state.desktop];
    if (!snapshot) return state;
    const ids = new Set(snapshot.ids);
    const windows = state.windows.map((win) =>
      win.desktop === state.desktop && ids.has(win.id) ? { ...win, minimized: false } : win,
    );
    const desktopVisibility = { ...state.desktopVisibility };
    delete desktopVisibility[state.desktop];
    const visibleId = (id: string | null) =>
      id !== null &&
      windows.some((win) => win.id === id && !win.minimized && win.desktop === state.desktop);
    const activeId = visibleId(state.activeId)
      ? state.activeId
      : visibleId(snapshot.activeId)
        ? snapshot.activeId
        : nextFocus(windows, state.desktop);
    return { ...state, windows, desktopVisibility, activeId };
  }
  const target = state.windows.find((win) => win.id === action.id);
  if (!target) return state;
  switch (action.type) {
    case 'close': {
      const cleaned = forgetVisibility(state, action.id);
      const windows = state.windows.filter((win) => win.id !== action.id);
      return {
        ...cleaned,
        windows,
        activeId: state.activeId === action.id ? nextFocus(windows, state.desktop) : state.activeId,
      };
    }
    case 'focus': {
      if (
        state.activeId === target.id &&
        state.desktop === target.desktop &&
        !target.minimized &&
        nextFocus(state.windows, state.desktop) === target.id
      )
        return state;
      return activate(state, action.id, (win) => win);
    }
    case 'minimize': {
      const cleaned = forgetVisibility(state, action.id);
      if (target.minimized) return cleaned;
      const windows = state.windows.map((win) =>
        win.id === action.id ? { ...win, minimized: true } : win,
      );
      return {
        ...cleaned,
        windows,
        activeId: state.activeId === action.id ? nextFocus(windows, state.desktop) : state.activeId,
      };
    }
    case 'title':
      return target.title === action.title
        ? state
        : replace(state, { ...target, title: action.title });
    case 'move-desktop': {
      const desktop = desktopId(action.desktop);
      if (target.desktop === desktop) return state;
      const cleaned = forgetVisibility(state, action.id);
      const windows = state.windows.map((win) =>
        win.id === action.id ? { ...win, desktop } : win,
      );
      return {
        ...cleaned,
        windows,
        activeId: state.activeId === action.id ? nextFocus(windows, state.desktop) : state.activeId,
      };
    }
    case 'bounds': {
      if (
        ![action.bounds.x, action.bounds.y, action.bounds.width, action.bounds.height].every(
          finite,
        ) ||
        action.bounds.width <= 0 ||
        action.bounds.height <= 0
      )
        return state;
      if (
        ['x', 'y', 'width', 'height'].every(
          (key) => target[key as keyof Bounds] === action.bounds[key as keyof Bounds],
        ) &&
        !(action.restore && (target.maximized || target.snap !== 'none' || target.restoreBounds))
      )
        return state;
      const changed = { ...target, ...action.bounds };
      if (action.restore) {
        changed.maximized = false;
        changed.snap = 'none';
        delete changed.restoreBounds;
      }
      return replace(state, changed);
    }
    case 'maximize':
      return activate(state, action.id, (win) => {
        if (win.maximized) {
          const changed = {
            ...win,
            ...(win.restoreBounds ?? pickBounds(win)),
            maximized: false,
            snap: 'none' as const,
          };
          delete changed.restoreBounds;
          return changed;
        }
        return {
          ...win,
          maximized: true,
          snap: 'none',
          restoreBounds:
            win.snap !== 'none' ? (win.restoreBounds ?? pickBounds(win)) : pickBounds(win),
        };
      });
    case 'snap':
      return activate(state, action.id, (win) => ({
        ...win,
        maximized: false,
        snap: action.side,
        restoreBounds:
          win.maximized || win.snap !== 'none'
            ? (win.restoreBounds ?? pickBounds(win))
            : pickBounds(win),
      }));
  }
}

function savedBounds(value: unknown): Bounds | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (
    !finite(v.x) ||
    !finite(v.y) ||
    !finite(v.width) ||
    !finite(v.height) ||
    v.width <= 0 ||
    v.height <= 0
  )
    return undefined;
  return {
    x: Math.max(-MAX_SAVED_DIMENSION, Math.min(MAX_SAVED_DIMENSION, v.x)),
    y: Math.max(-MAX_SAVED_DIMENSION, Math.min(MAX_SAVED_DIMENSION, v.y)),
    width: Math.min(MAX_SAVED_DIMENSION, v.width),
    height: Math.min(MAX_SAVED_DIMENSION, v.height),
  };
}

export function restoreWindowSession(raw: string | null, knownApps: Set<string>): WindowState {
  const empty = (): WindowState => ({ windows: [], activeId: null, desktop: 0 });
  if (!raw) return empty();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty();
    const parsed = value as Record<string, unknown>;
    if (!Array.isArray(parsed.windows)) return empty();
    const now = Date.now();
    const accepted: DesktopWindow[] = [];
    for (const item of parsed.windows.slice(0, MAX_WINDOWS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const v = item as Record<string, unknown>;
      const bounds = savedBounds(v);
      if (
        !bounds ||
        typeof v.id !== 'string' ||
        !v.id ||
        v.id.length > 256 ||
        typeof v.appId !== 'string' ||
        !knownApps.has(v.appId) ||
        typeof v.title !== 'string' ||
        !finite(v.zIndex) ||
        accepted.some((win) => win.id === v.id)
      )
        continue;
      const maximized = v.maximized === true;
      const window: DesktopWindow = {
        ...bounds,
        id: v.id,
        appId: v.appId,
        title: v.title.slice(0, 200),
        zIndex: v.zIndex,
        minimized: v.minimized === true,
        maximized,
        snap: !maximized && (v.snap === 'left' || v.snap === 'right') ? v.snap : 'none',
        desktop: desktopId(v.desktop),
        openedAt: finite(v.openedAt) && v.openedAt >= 0 && v.openedAt <= now ? v.openedAt : now,
      };
      const restore = savedBounds(v.restoreBounds);
      if (restore && (window.maximized || window.snap !== 'none')) window.restoreBounds = restore;
      if (v.data && typeof v.data === 'object' && !Array.isArray(v.data)) {
        const data = v.data as Record<string, unknown>;
        const allowed: Record<string, string> = {};
        for (const key of ['fileId', 'folderId']) {
          const id = data[key];
          if (typeof id === 'string' && id.length > 0 && id.length <= 256) allowed[key] = id;
        }
        if (Object.keys(allowed).length) window.data = allowed;
      }
      accepted.push(window);
    }
    const windows = rankedWindows(accepted);
    const desktop = desktopId(parsed.desktop);
    const activeId =
      typeof parsed.activeId === 'string' &&
      windows.some((win) => win.id === parsed.activeId && win.desktop === desktop && !win.minimized)
        ? parsed.activeId
        : nextFocus(windows, desktop);
    // A restored active window must also be at the top of its desktop's stacking order.
    if (activeId && nextFocus(windows, desktop) !== activeId) {
      const active = windows.find((win) => win.id === activeId)!;
      active.zIndex = windows.length + 1;
    }
    const restored: WindowState = { windows, desktop, activeId };
    if (parsed.desktopVisibility && typeof parsed.desktopVisibility === 'object') {
      const snapshots = parsed.desktopVisibility as Record<string, unknown>;
      const validated: Record<number, DesktopVisibilitySnapshot> = {};
      for (const desktop of [0, 1]) {
        const value = snapshots[String(desktop)];
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const snapshot = value as Record<string, unknown>;
        if (!Array.isArray(snapshot.ids)) continue;
        const ids = [
          ...new Set(
            snapshot.ids
              .slice(0, MAX_WINDOWS)
              .filter(
                (id): id is string =>
                  typeof id === 'string' &&
                  windows.some((win) => win.id === id && win.desktop === desktop && win.minimized),
              ),
          ),
        ];
        if (!ids.length) continue;
        validated[desktop] = {
          ids,
          activeId:
            typeof snapshot.activeId === 'string' && ids.includes(snapshot.activeId)
              ? snapshot.activeId
              : null,
        };
      }
      if (Object.keys(validated).length) restored.desktopVisibility = validated;
    }
    return restored;
  } catch {
    return empty();
  }
}
