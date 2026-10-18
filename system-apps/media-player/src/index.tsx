import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '@browos/sdk';
import './apps.css';

function isMedia(name: string, mime: string) {
  return (
    mime.startsWith('audio/') ||
    mime.startsWith('video/') ||
    /\.(mp3|wav|ogg|oga|flac|m4a|aac|mp4|webm|ogv|mov)$/i.test(name)
  );
}
function timeLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  return `${Math.floor(value / 60)}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;
}

export function MediaPlayerApp({ services, windowId, data }: AppProps) {
  const [fileId, setFileId] = useState<string | undefined>(
    typeof data?.fileId === 'string' ? data.fileId : undefined,
  );
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const node = fileId ? services.fs.get(fileId) : undefined;
  const video = Boolean(
    node && (node.mime.startsWith('video/') || /\.(mp4|webm|ogv|mov)$/i.test(node.name)),
  );
  const playlist = useMemo(
    () =>
      node?.parentId
        ? services.fs
            .list(node.parentId)
            .filter((item) => item.kind === 'file' && isMedia(item.name, item.mime))
        : [],
    [node?.parentId, services.fs, services.revision],
  );
  const index = playlist.findIndex((item) => item.id === fileId);

  useEffect(
    () => services.setTitle(windowId, `${node?.name ? `${node.name} — ` : ''}Медиаплеер`),
    [node?.name, windowId, services.setTitle],
  );
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let objectUrl = '';
    setUrl('');
    setError('');
    setLoading(true);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    services.fs
      .readFile(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть медиафайл');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, services.fs, node?.updatedAt]);
  useEffect(() => {
    if (media.current) media.current.playbackRate = rate;
  }, [rate, url]);

  async function open() {
    const id = await services.pickFile({
      accept: 'audio/*,video/*',
      title: 'Открыть аудио или видео',
    });
    if (id) {
      setFileId(id);
      setAutoplay(false);
    }
  }
  function navigate(direction: number, continuePlaying = playing) {
    const next = playlist[index + direction];
    if (next) {
      setAutoplay(continuePlaying);
      setFileId(next.id);
    }
  }
  const mediaProps = {
    src: url,
    controls: true,
    autoPlay: autoplay,
    loop,
    preload: 'metadata',
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      if (!loop) navigate(1, true);
    },
    onLoadedMetadata: () => {
      if (media.current) {
        setDuration(media.current.duration);
        media.current.playbackRate = rate;
      }
    },
    onTimeUpdate: () => {
      if (media.current) setCurrentTime(media.current.currentTime);
    },
    onError: () =>
      setError(
        'Браузер не может воспроизвести этот формат или файл повреждён. Поддержка кодеков зависит от вашего браузера.',
      ),
  };

  return (
    <section className="browos-media" aria-label="Медиаплеер">
      <div className="app-toolbar browos-media-toolbar">
        <button type="button" className="app-button" onClick={() => void open()}>
          Открыть файл
        </button>
        <span className="browos-media-title">{node?.name || 'Медиаплеер BROwOS'}</span>
        <label>
          Скорость{' '}
          <select
            aria-label="Скорость воспроизведения"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="app-button"
          aria-pressed={loop}
          onClick={() => setLoop((value) => !value)}
        >
          ↻ Повтор
        </button>
      </div>
      <div className="browos-media-stage">
        {loading ? (
          <p role="status">Загрузка медиафайла…</p>
        ) : error ? (
          <div className="browos-media-error" role="alert">
            {error}
            <button type="button" className="app-button" onClick={() => void open()}>
              Открыть другой файл
            </button>
          </div>
        ) : url ? (
          video ? (
            <video
              key={url}
              ref={(element) => {
                media.current = element;
              }}
              {...mediaProps}
              playsInline
              aria-label={node?.name || 'Видео'}
            />
          ) : (
            <div className="browos-media-audio">
              <div className={`browos-media-record ${playing ? 'playing' : ''}`}>
                <div>
                  <span>♪</span>
                  <small>BROwOS</small>
                </div>
              </div>
              <h2>{node?.name}</h2>
              <p>
                {playing ? 'Сейчас играет' : 'Аудиофайл'} · {timeLabel(duration)}
              </p>
              <audio
                key={url}
                ref={(element) => {
                  media.current = element;
                }}
                {...mediaProps}
                aria-label={node?.name || 'Аудио'}
              />
            </div>
          )
        ) : (
          <div className="browos-media-empty">
            <div className="browos-media-empty-icon" aria-hidden="true">
              ▶
            </div>
            <h2>Ваша музыка. Ваше видео.</h2>
            <p>
              Загрузите медиафайл через Проводник и откройте его здесь. Воспроизведение работает
              локально.
            </p>
            <button type="button" className="app-button" onClick={() => void open()}>
              Выбрать файл
            </button>
          </div>
        )}
      </div>
      {playlist.length > 0 && (
        <div className="browos-media-bottom">
          <div className="browos-media-navigation">
            <button
              type="button"
              className="app-button"
              onClick={() => navigate(-1)}
              disabled={index <= 0}
              aria-label="Предыдущий медиафайл"
            >
              ⏮
            </button>
            <span>
              {timeLabel(currentTime)} / {timeLabel(duration)}
            </span>
            <button
              type="button"
              className="app-button"
              onClick={() => navigate(1)}
              disabled={index >= playlist.length - 1}
              aria-label="Следующий медиафайл"
            >
              ⏭
            </button>
            <span className="browos-media-playlist-label">В этой папке: {playlist.length}</span>
          </div>
          <div className="browos-media-playlist" aria-label="Файлы в папке">
            {playlist.map((item, itemIndex) => (
              <button
                type="button"
                key={item.id}
                className={item.id === fileId ? 'selected' : ''}
                onClick={() => {
                  setAutoplay(playing);
                  setFileId(item.id);
                }}
                aria-pressed={item.id === fileId}
              >
                <span>{String(itemIndex + 1).padStart(2, '0')}</span>
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
