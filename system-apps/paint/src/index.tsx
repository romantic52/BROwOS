import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { AppProps } from '@browos/sdk';
import './apps.css';

type Tool = 'brush' | 'eraser' | 'line' | 'rectangle' | 'ellipse';
type Snapshot = { image: ImageData; width: number; height: number };
const palette = [
  '#111827',
  '#6b7280',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#0078d4',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];

export function PaintApp({ services, windowId, data }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(-1);
  const drawing = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const preview = useRef<ImageData | null>(null);
  const dirtyRef = useRef(false);
  const savedSnapshot = useRef<Snapshot | null>(null);
  const savedVersion = useRef<number | undefined>(undefined);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#0078d4');
  const [width, setWidth] = useState(6);
  const [dimensions, setDimensions] = useState({ width: 960, height: 540 });
  const [historyState, setHistoryState] = useState({ index: -1, length: 0 });
  const [dirty, setDirty] = useState(false);
  const [fileId, setFileId] = useState<string | undefined>(
    typeof data?.fileId === 'string' ? data.fileId : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = (fileId && services.fs.get(fileId)?.name) || 'Рисунок.png';
  const initialFileId = useRef(fileId);

  const setModified = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const commit = useCallback(
    (isInitial = false) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const snapshot = {
        image: context.getImageData(0, 0, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height,
      };
      // Bound undo memory for imported images; default canvases retain 18 snapshots.
      const limit = Math.max(
        2,
        Math.min(18, Math.floor((48 * 1024 * 1024) / snapshot.image.data.byteLength)),
      );
      history.current = [...history.current.slice(0, historyIndex.current + 1), snapshot].slice(
        -limit,
      );
      historyIndex.current = history.current.length - 1;
      if (isInitial) savedSnapshot.current = snapshot;
      setModified(snapshot !== savedSnapshot.current);
      setHistoryState({ index: historyIndex.current, length: history.current.length });
    },
    [setModified],
  );

  useEffect(() => {
    services.setCloseGuard(
      windowId,
      dirty
        ? () => !dirtyRef.current || window.confirm('Рисунок изменён. Закрыть без сохранения?')
        : null,
    );
    return () => services.setCloseGuard(windowId, null);
  }, [services.setCloseGuard, windowId, dirty]);
  useEffect(
    () => services.setTitle(windowId, `${dirty ? '● ' : ''}${name} — Paint`),
    [dirty, name, services.setTitle, windowId],
  );

  const loadImage = useCallback(
    async (id: string, cancelled: () => boolean = () => false) => {
      setBusy(true);
      let url = '';
      try {
        const blob = await services.fs.readFile(id);
        const version = services.fs.get(id)?.updatedAt;
        url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        await image.decode();
        if (cancelled()) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setDimensions({ width: canvas.width, height: canvas.height });
        history.current = [];
        historyIndex.current = -1;
        commit(true);
        savedVersion.current = version;
        setFileId(id);
        setError('');
        if (scale < 1) services.notify('Изображение уменьшено до 1600 пикселей по длинной стороне');
      } catch (cause) {
        if (!cancelled())
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть изображение');
      } finally {
        if (url) URL.revokeObjectURL(url);
        if (!cancelled()) setBusy(false);
      }
    },
    [services.fs, services.notify, commit],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      history.current = [];
      historyIndex.current = -1;
      commit(true);
    }
    let cancelled = false;
    if (initialFileId.current) void loadImage(initialFileId.current, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [commit, loadImage]);

  function coordinates(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }
  function configure(context: CanvasRenderingContext2D) {
    context.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    context.fillStyle = tool === 'eraser' ? '#ffffff' : color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (busy || event.button !== 0) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    start.current = coordinates(event);
    configure(context);
    if (tool === 'brush' || tool === 'eraser') {
      context.beginPath();
      context.arc(start.current.x, start.current.y, width / 2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(start.current.x, start.current.y);
    } else
      preview.current = context.getImageData(
        0,
        0,
        event.currentTarget.width,
        event.currentTarget.height,
      );
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = coordinates(event);
    configure(context);
    if (tool === 'brush' || tool === 'eraser') {
      context.lineTo(point.x, point.y);
      context.stroke();
      return;
    }
    if (preview.current) context.putImageData(preview.current, 0, 0);
    context.beginPath();
    if (tool === 'line') {
      context.moveTo(start.current.x, start.current.y);
      context.lineTo(point.x, point.y);
    } else if (tool === 'rectangle')
      context.rect(
        start.current.x,
        start.current.y,
        point.x - start.current.x,
        point.y - start.current.y,
      );
    else
      context.ellipse(
        (point.x + start.current.x) / 2,
        (point.y + start.current.y) / 2,
        Math.abs(point.x - start.current.x) / 2,
        Math.abs(point.y - start.current.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
    context.stroke();
  }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    pointerMove(event);
    drawing.current = false;
    preview.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    commit();
  }
  function restoreHistory(direction: number) {
    const index = historyIndex.current + direction;
    const snapshot = history.current[index];
    const canvas = canvasRef.current;
    if (!snapshot || !canvas || busy) return;
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    canvas.getContext('2d')?.putImageData(snapshot.image, 0, 0);
    setDimensions({ width: snapshot.width, height: snapshot.height });
    historyIndex.current = index;
    setHistoryState({ index, length: history.current.length });
    setModified(snapshot !== savedSnapshot.current);
  }
  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    commit();
  }
  async function open() {
    if (
      dirtyRef.current &&
      !window.confirm('Открыть изображение и отказаться от несохранённых изменений?')
    )
      return;
    const id = await services.pickFile({ accept: 'image/*', title: 'Открыть изображение в Paint' });
    if (id) await loadImage(id);
  }
  async function save(asNew = false) {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    try {
      const snapshot = history.current[historyIndex.current];
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Не удалось создать PNG'))),
          'image/png',
        ),
      );
      const isPng = name.toLowerCase().endsWith('.png');
      let id: string | null;
      if (!asNew && fileId && isPng) {
        if (savedVersion.current === undefined)
          throw new Error('Исходное изображение не было загружено. Используйте «Сохранить как».');
        const saved = await services.fs.updateFile(fileId, blob, 'image/png', savedVersion.current);
        id = saved.id;
        savedVersion.current = saved.updatedAt;
      } else {
        id = await services.saveFile({
          name: name.replace(/\.[^.]+$/, '') + '.png',
          content: blob,
          mime: 'image/png',
          parentId: 'pictures',
        });
        if (id) savedVersion.current = services.fs.get(id)?.updatedAt;
      }
      if (id) {
        setFileId(id);
        savedSnapshot.current = snapshot ?? null;
        setModified(history.current[historyIndex.current] !== savedSnapshot.current);
        setError('');
        services.notify('Рисунок сохранён в PNG', 'success');
      }
    } catch (cause) {
      setError(
        cause && typeof cause === 'object' && 'code' in cause && cause.code === 'CONFLICT'
          ? 'Изображение изменено в другом окне или вкладке. Рисунок остаётся на холсте. Используйте «Сохранить как» для отдельной копии.'
          : cause instanceof Error
            ? cause.message
            : 'Не удалось сохранить рисунок',
      );
    } finally {
      setBusy(false);
    }
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save(event.shiftKey);
    }
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restoreHistory(event.shiftKey ? 1 : -1);
    }
    if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      restoreHistory(1);
    }
  }

  return (
    <section className="browos-paint" aria-label="Paint" onKeyDown={keyboard} tabIndex={0}>
      <div className="app-toolbar browos-paint-toolbar">
        <button type="button" className="app-button" onClick={() => void open()} disabled={busy}>
          Открыть
        </button>
        <button type="button" className="app-button" onClick={() => void save()} disabled={busy}>
          Сохранить PNG
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => void save(true)}
          disabled={busy}
        >
          Сохранить как
        </button>
        <span className="browos-paint-separator" />
        <button
          type="button"
          className="app-button"
          onClick={() => restoreHistory(-1)}
          disabled={busy || historyState.index < 1}
          title="Ctrl+Z"
        >
          ↶ Отменить
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => restoreHistory(1)}
          disabled={busy || historyState.index >= historyState.length - 1}
          title="Ctrl+Y"
        >
          ↷ Повторить
        </button>
        <button type="button" className="app-button" onClick={clear} disabled={busy}>
          Очистить
        </button>
      </div>
      <div className="browos-paint-ribbon">
        <div className="browos-paint-tools" aria-label="Инструменты рисования">
          {(
            [
              ['brush', '✎', 'Кисть'],
              ['eraser', '▱', 'Ластик'],
              ['line', '╱', 'Линия'],
              ['rectangle', '□', 'Прямоугольник'],
              ['ellipse', '○', 'Эллипс'],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              type="button"
              key={id}
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
              disabled={busy}
            >
              {icon}
            </button>
          ))}
        </div>
        <label className="browos-paint-width">
          Толщина{' '}
          <input
            type="range"
            min="1"
            max="60"
            value={width}
            aria-label="Толщина кисти"
            onChange={(event) => setWidth(Number(event.target.value))}
          />
          <span>{width} px</span>
        </label>
        <div className="browos-paint-palette" aria-label="Палитра">
          {palette.map((value) => (
            <button
              type="button"
              key={value}
              style={{ backgroundColor: value }}
              aria-label={`Цвет ${value}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            />
          ))}
          <label title="Другой цвет">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              aria-label="Другой цвет кисти"
            />
          </label>
        </div>
      </div>
      {error && (
        <div className="browos-paint-error" role="alert">
          {error}
        </div>
      )}
      <div className="browos-paint-stage">
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          aria-label="Холст для рисования"
          data-testid="paint-canvas"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        />
      </div>
      <footer className="app-statusbar browos-paint-status">
        <span>
          {dimensions.width} × {dimensions.height} px
        </span>
        <span>{busy ? 'Обработка…' : dirty ? 'Рисунок изменён' : 'Сохранено'}</span>
        <span>PNG · {historyState.length} снимков истории</span>
      </footer>
    </section>
  );
}
