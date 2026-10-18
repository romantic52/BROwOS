import { useEffect, useState } from 'react';
import type { AppProps } from '@browos/sdk';
import type { DesktopWindow } from '@browos/window-manager';
import { Icon } from '@browos/ui';
import { formatBytes } from '@browos/shared';

export function TaskManagerApp({
  services,
  windows,
  closeWindow,
}: AppProps & { windows: DesktopWindow[]; closeWindow: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const usage = services.fs.getUsage();
  return (
    <div className="task-manager-app">
      <div className="task-manager-summary">
        <div>
          <strong>{windows.length}</strong>
          <span>приложений</span>
        </div>
        <div>
          <strong>{usage.files}</strong>
          <span>файлов</span>
        </div>
        <div>
          <strong>{formatBytes(usage.bytes)}</strong>
          <span>данных</span>
        </div>
      </div>
      <div className="task-manager-caption">
        <Icon name="chart" size={19} />
        <strong>Приложения BROwOS</strong>
        <span>Процессы этого рабочего стола</span>
      </div>
      <div className="task-manager-table">
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Состояние</th>
              <th>Рабочий стол</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((win) => (
              <tr
                key={win.id}
                className={selected === win.id ? 'selected' : ''}
                tabIndex={0}
                onClick={() => setSelected(win.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelected(win.id);
                }}
              >
                <td>{win.title}</td>
                <td>{win.minimized ? 'Свёрнуто' : 'Открыто'}</td>
                <td>{win.desktop + 1}</td>
                <td>{Math.max(0, Math.floor((now - win.openedAt) / 60000))} мин</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        <p>
          Веб-браузер не предоставляет загрузку CPU и память каждого окна. Показаны реальные окна и
          объём файлов BROwOS.
        </p>
        <button
          className="app-button"
          disabled={!selected || !windows.some((w) => w.id === selected)}
          onClick={() => {
            if (selected) closeWindow(selected);
          }}
        >
          Завершить приложение
        </button>
      </footer>
    </div>
  );
}
