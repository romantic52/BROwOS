import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '@browos/sdk';
import './apps.css';

export function PhotosApp({ services, windowId, data }: AppProps) {
  const [fileId, setFileId] = useState<string | undefined>(
    typeof data?.fileId === 'string' ? data.fileId : undefined,
  );
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 640, height: 400 });
  const stage = useRef<HTMLDivElement>(null);
  const node = fileId ? services.fs.get(fileId) : undefined;
  const siblings = useMemo(
    () =>
      node?.parentId
        ? services.fs
            .list(node.parentId)
            .filter(
              (item) =>
                item.kind === 'file' &&
                (item.mime.startsWith('image/') ||
                  /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(item.name)),
            )
        : [],
    [node?.parentId, services.fs, services.revision],
  );
  const index = siblings.findIndex((item) => item.id === fileId);
  const turned = rotation % 180 !== 0;
  const rotatedWidth = (turned ? dimensions.height : dimensions.width) || 1;
  const rotatedHeight = (turned ? dimensions.width : dimensions.height) || 1;
  const imageScale =
    Math.max(
      0.01,
      Math.min((viewport.width - 40) / rotatedWidth, (viewport.height - 40) / rotatedHeight),
    ) * zoom;

  useEffect(() => {
    const target = stage.current;
    if (!target) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: target.clientWidth, height: target.clientHeight }),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => services.setTitle(windowId, `${node?.name ? `${node.name} — ` : ''}Фотографии`),
    [node?.name, windowId, services.setTitle],
  );
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let objectUrl = '';
    setUrl('');
    setLoading(true);
    setError('');
    setZoom(1);
    setRotation(0);
    setDimensions({ width: 0, height: 0 });
    services.fs
      .readFile(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Не удалось прочитать изображение');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, services.fs, node?.updatedAt]);

  async function open() {
    const id = await services.pickFile({ accept: 'image/*', title: 'Открыть изображение' });
    if (id) setFileId(id);
  }
  function navigate(direction: number) {
    const next = siblings[index + direction];
    if (next) setFileId(next.id);
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement)
      return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }
    if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + 0.25));
    if (event.key === '-') setZoom((value) => Math.max(0.25, value - 0.25));
    if (event.key.toLowerCase() === 'r') setRotation((value) => (value + 90) % 360);
    if (event.key === '0') {
      setZoom(1);
      setRotation(0);
    }
  }

  return (
    <section className="browos-photos" aria-label="Фотографии" tabIndex={0} onKeyDown={keyboard}>
      <div className="app-toolbar browos-photos-toolbar">
        <button type="button" className="app-button" onClick={() => void open()}>
          Открыть
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => navigate(-1)}
          disabled={index <= 0}
          aria-label="Предыдущее изображение"
        >
          ‹
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => navigate(1)}
          disabled={index < 0 || index >= siblings.length - 1}
          aria-label="Следующее изображение"
        >
          ›
        </button>
        <span className="browos-photos-name">{node?.name || 'Фотографии BROwOS'}</span>
        <button
          type="button"
          className="app-button"
          onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
          disabled={!url || zoom <= 0.25}
          aria-label="Уменьшить изображение"
        >
          −
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => {
            setZoom(1);
            setRotation(0);
          }}
          disabled={!url}
          title="Вписать в окно"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
          disabled={!url || zoom >= 4}
          aria-label="Увеличить изображение"
        >
          +
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => setRotation((value) => (value + 90) % 360)}
          disabled={!url}
        >
          ↻ Повернуть
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => services.openApp('paint', { fileId })}
          disabled={!url}
        >
          Изменить в Paint
        </button>
      </div>
      <div className="browos-photos-stage" ref={stage}>
        {loading ? (
          <div className="browos-photos-empty" role="status">
            Загрузка изображения…
          </div>
        ) : error ? (
          <div className="browos-photos-empty browos-photos-error" role="alert">
            {error}
          </div>
        ) : url ? (
          <div
            className="browos-photos-image-wrap"
            style={{
              width: Math.max(viewport.width, rotatedWidth * imageScale + 40),
              height: Math.max(viewport.height, rotatedHeight * imageScale + 40),
            }}
          >
            <img
              src={url}
              alt={node?.name || 'Изображение'}
              style={{
                width: dimensions.width * imageScale,
                height: dimensions.height * imageScale,
                transform: `rotate(${rotation}deg)`,
              }}
              onLoad={(event) =>
                setDimensions({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() =>
                setError(
                  'Браузер не может декодировать это изображение. Откройте PNG, JPEG, WebP, GIF или SVG.',
                )
              }
            />
          </div>
        ) : (
          <div className="browos-photos-empty">
            <span className="browos-photos-symbol" aria-hidden="true">
              ▧
            </span>
            <h2>Ваши изображения</h2>
            <p>Откройте фотографию из файловой системы BROwOS.</p>
            <button type="button" className="app-button" onClick={() => void open()}>
              Выбрать изображение
            </button>
          </div>
        )}
      </div>
      <footer className="app-statusbar browos-photos-status">
        <span>
          {dimensions.width
            ? `${dimensions.width} × ${dimensions.height} px`
            : 'PNG · JPEG · WebP · GIF · SVG'}
        </span>
        <span>{index >= 0 ? `${index + 1} из ${siblings.length}` : ''}</span>
        <span>← → — навигация · R — поворот</span>
      </footer>
    </section>
  );
}
