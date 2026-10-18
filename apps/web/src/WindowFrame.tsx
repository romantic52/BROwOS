import { useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { Icon } from '@browos/ui';
import { visibleBounds } from '@browos/window-manager';
import type { Bounds, DesktopWindow, WindowAction } from '@browos/window-manager';

export function WindowFrame({
  win,
  active,
  viewport,
  dispatch,
  close,
  children,
  icon,
  color,
  currentDesktop,
}: {
  win: DesktopWindow;
  active: boolean;
  viewport: { width: number; height: number };
  dispatch: (action: WindowAction) => void;
  close: (id: string) => void;
  children: ReactNode;
  icon: string;
  color: string;
  currentDesktop: number;
}) {
  const actionRef = useRef<{ kind: string; x: number; y: number; bounds: Bounds } | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [snapHint, setSnapHint] = useState<'left' | 'right' | 'top' | null>(null);
  const [snapMenu, setSnapMenu] = useState(false);
  const b = visibleBounds(win, viewport);
  function begin(event: PointerEvent<HTMLElement>, kind: string) {
    if (event.button !== 0) return;
    if (kind === 'move' && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    dispatch({ type: 'focus', id: win.id });
    let bounds = b;
    if (kind === 'move' && (win.maximized || win.snap !== 'none')) {
      const saved = win.restoreBounds ?? win;
      bounds = {
        ...saved,
        x: Math.max(0, event.clientX - saved.width / 2),
        y: Math.max(0, event.clientY - 16),
      };
      dispatch({ type: 'bounds', id: win.id, bounds, restore: true });
    }
    actionRef.current = { kind, x: event.clientX, y: event.clientY, bounds };
    setInteracting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const action = actionRef.current;
    if (!action) return;
    const dx = event.clientX - action.x,
      dy = event.clientY - action.y;
    const next = { ...action.bounds };
    if (action.kind === 'move') {
      next.x = Math.max(0, Math.min(viewport.width - 100, action.bounds.x + dx));
      next.y = Math.max(0, Math.min(viewport.height - 80, action.bounds.y + dy));
      setSnapHint(
        event.clientY < 10
          ? 'top'
          : event.clientX < 18
            ? 'left'
            : event.clientX > viewport.width - 18
              ? 'right'
              : null,
      );
    } else {
      if (action.kind.includes('e')) next.width = Math.max(300, action.bounds.width + dx);
      if (action.kind.includes('s')) next.height = Math.max(200, action.bounds.height + dy);
      if (action.kind.includes('w')) {
        next.width = Math.max(300, action.bounds.width - dx);
        next.x = action.bounds.x + action.bounds.width - next.width;
      }
      if (action.kind.includes('n')) {
        next.height = Math.max(200, action.bounds.height - dy);
        next.y = action.bounds.y + action.bounds.height - next.height;
      }
    }
    dispatch({ type: 'bounds', id: win.id, bounds: next });
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (!actionRef.current) return;
    if (actionRef.current.kind === 'move') {
      if (snapHint === 'top') dispatch({ type: 'maximize', id: win.id });
      if (snapHint === 'left' || snapHint === 'right')
        dispatch({ type: 'snap', id: win.id, side: snapHint });
    }
    actionRef.current = null;
    setInteracting(false);
    setSnapHint(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const hidden = win.minimized || win.desktop !== currentDesktop;
  return (
    <>
      {snapHint && <div className={`snap-preview snap-${snapHint}`} />}
      <section
        data-testid={`window-${win.appId}`}
        data-window-id={win.id}
        aria-label={win.title}
        role="region"
        className={`os-window ${active ? 'active' : ''} ${win.maximized ? 'maximized' : ''} ${interacting ? 'interacting' : ''}`}
        style={{
          left: b.x,
          top: b.y,
          width: b.width,
          height: b.height,
          zIndex: win.zIndex + 10,
          display: hidden ? 'none' : undefined,
        }}
        onPointerDownCapture={() => {
          if (!active) dispatch({ type: 'focus', id: win.id });
        }}
      >
        <header
          className="window-titlebar"
          onPointerDown={(e) => begin(e, 'move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('button'))
              dispatch({ type: 'maximize', id: win.id });
          }}
        >
          <Icon name={icon} color={color} size={16} />
          <span className="window-title">{win.title}</span>
          <div className="window-controls">
            <button
              title="Прикрепить окно"
              aria-label="Прикрепить окно"
              onClick={() => setSnapMenu(!snapMenu)}
            >
              <Icon name="down" size={12} />
            </button>
            <button
              title="Свернуть"
              aria-label="Свернуть"
              onClick={() => dispatch({ type: 'minimize', id: win.id })}
            >
              <Icon name="minus" size={13} />
            </button>
            <button
              title={win.maximized ? 'Восстановить' : 'Развернуть'}
              aria-label={win.maximized ? 'Восстановить' : 'Развернуть'}
              onClick={() => dispatch({ type: 'maximize', id: win.id })}
            >
              <Icon name={win.maximized ? 'restore' : 'maximize'} size={12} />
            </button>
            <button
              title="Закрыть"
              aria-label="Закрыть"
              className="window-close"
              onClick={() => close(win.id)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>
        {snapMenu && (
          <div className="window-snap-menu">
            <button
              onClick={() => {
                dispatch({ type: 'snap', id: win.id, side: 'left' });
                setSnapMenu(false);
              }}
            >
              ← Левая половина
            </button>
            <button
              onClick={() => {
                dispatch({ type: 'snap', id: win.id, side: 'right' });
                setSnapMenu(false);
              }}
            >
              Правая половина →
            </button>
            <button
              onClick={() => {
                dispatch({ type: 'move-desktop', id: win.id, desktop: win.desktop === 0 ? 1 : 0 });
                setSnapMenu(false);
              }}
            >
              На рабочий стол {win.desktop === 0 ? '2' : '1'}
            </button>
          </div>
        )}
        <div className="window-content">{children}</div>
        {!win.maximized &&
          win.snap === 'none' &&
          ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((edge) => (
            <div
              key={edge}
              className={`resize-handle resize-${edge}`}
              onPointerDown={(e) => begin(e, edge)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
      </section>
    </>
  );
}
