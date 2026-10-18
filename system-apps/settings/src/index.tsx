import { useEffect, useRef, useState } from 'react';
import type { AppProps } from '@browos/sdk';
import type { SystemSettings } from '@browos/kernel';
import { Icon } from '@browos/ui';
import { errorMessage, formatBytes, VERSION } from '@browos/shared';
import './style.css';

export function SettingsApp({
  services,
  data,
  settings,
  updateSettings,
}: AppProps & {
  settings: SystemSettings;
  updateSettings: (patch: Partial<SystemSettings>) => void;
}) {
  const [section, setSection] = useState(
    typeof data?.section === 'string' ? data.section : 'personalization',
  );
  const [usage, setUsage] = useState<StorageEstimate | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const backupRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (navigator.storage) {
      void navigator.storage
        .estimate()
        .then(setUsage)
        .catch(() => {});
      void navigator.storage
        .persisted()
        .then(setPersistent)
        .catch(() => {});
    }
  }, [services.revision]);
  async function backup() {
    setBusy(true);
    try {
      const contents = await services.fs.exportBackup();
      const blob = new Blob([contents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BROwOS-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      services.notify('Резервная копия подготовлена для скачивания', 'success');
    } catch (e) {
      services.notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function restore(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 140000000) throw new Error('Резервная копия больше допустимого размера');
      await services.fs.importBackup(await file.text());
      services.notify('Файлы из резервной копии добавлены', 'success');
    } catch (e) {
      services.notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  const toggle = (
    title: string,
    description: string,
    key: 'clock24' | 'reduceMotion' | 'restoreSession' | 'showSeconds',
  ) => (
    <label className="settings-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => updateSettings({ [key]: e.target.checked })}
      />
      <i />
    </label>
  );
  const currentUsage = services.fs.getUsage();
  return (
    <div className="settings-app">
      <nav>
        <div className="settings-user">
          <span>{settings.username[0].toUpperCase()}</span>
          <div>
            <strong>{settings.username}</strong>
            <small>Локальный профиль</small>
          </div>
        </div>
        <h3>Параметры BROwOS</h3>
        {[
          ['personalization', 'paint', 'Персонализация'],
          ['storage', 'folder', 'Файлы и хранилище'],
          ['system', 'computer', 'Система'],
          ['connection', 'network', 'Режимы работы'],
          ['about', 'info', 'О программе'],
        ].map(([id, icon, title]) => (
          <button
            className={section === id ? 'selected' : ''}
            key={id}
            onClick={() => setSection(id)}
          >
            <Icon name={icon} size={19} />
            {title}
          </button>
        ))}
      </nav>
      <main>
        {section === 'personalization' ? (
          <>
            <h1>Сделайте BROwOS своим</h1>
            <p className="settings-intro">Немного вас в каждом окне.</p>
            <div className={`wallpaper-preview wallpaper-${settings.wallpaper}`}>
              <Icon name="logo" size={61} />
              <div>
                <span>BROwOS</span>
                <small>Ваше пространство</small>
              </div>
              <footer />
            </div>
            <h2>Фон рабочего стола</h2>
            <div className="wallpaper-options">
              {[
                ['azure', 'Лазурный'],
                ['midnight', 'Полночь'],
                ['sunset', 'Закат'],
                ['forest', 'Лес'],
              ].map(([id, title]) => (
                <button
                  className={`wallpaper-option wallpaper-${id} ${settings.wallpaper === id ? 'selected' : ''}`}
                  key={id}
                  aria-label={`Фон ${title}`}
                  onClick={() => updateSettings({ wallpaper: id as SystemSettings['wallpaper'] })}
                >
                  {settings.wallpaper === id && <Icon name="check" size={19} />}
                  <span>{title}</span>
                </button>
              ))}
            </div>
            <h2>Цвет акцента</h2>
            <div className="accent-options">
              {[
                '#0078d4',
                '#0099bc',
                '#008a70',
                '#744da9',
                '#c33a63',
                '#bd5d26',
                '#4d6272',
                '#0063b1',
              ].map((color) => (
                <button
                  key={color}
                  aria-label={`Акцент ${color}`}
                  className={settings.accent === color ? 'selected' : ''}
                  style={{ background: color }}
                  onClick={() => updateSettings({ accent: color })}
                >
                  {settings.accent === color && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
            <h2>Тема приложений</h2>
            <div className="theme-options">
              <button
                className={settings.theme === 'light' ? 'selected' : ''}
                onClick={() => updateSettings({ theme: 'light' })}
              >
                <Icon name="sun" />
                Светлая
              </button>
              <button
                className={settings.theme === 'dark' ? 'selected' : ''}
                onClick={() => updateSettings({ theme: 'dark' })}
              >
                <Icon name="moon" />
                Тёмная
              </button>
            </div>
            {toggle('Уменьшить анимацию', 'Спокойные переходы и меньше движения.', 'reduceMotion')}
          </>
        ) : section === 'storage' ? (
          <>
            <h1>Файлы и хранилище</h1>
            <p className="settings-intro">
              Данные находятся в профиле этого браузера, на этом устройстве.
            </p>
            <div className="storage-summary">
              <Icon name="folder" size={43} />
              <div>
                <strong>{formatBytes(currentUsage.bytes)}</strong>
                <span>{currentUsage.files} файлов, включая корзину</span>
              </div>
            </div>
            {usage && (
              <div className="storage-quota">
                <div>
                  <span>Данные сайта</span>
                  <strong>
                    {formatBytes(usage.usage || 0)} из {formatBytes(usage.quota || 0)}
                  </strong>
                </div>
                <progress max={usage.quota || 1} value={usage.usage || 0} />
                <small>Размер по оценке браузера, включая служебные данные.</small>
              </div>
            )}
            <h2>Резервная копия</h2>
            <p className="settings-paragraph">
              Сохраните все папки и файлы одним JSON-файлом. При импорте существующие файлы
              сохраняются, совпадения получают новые имена.
            </p>
            <div className="settings-actions">
              <button className="app-button primary" disabled={busy} onClick={() => void backup()}>
                <Icon name="download" size={17} />
                Экспортировать всё
              </button>
              <button
                className="app-button"
                disabled={busy}
                onClick={() => backupRef.current?.click()}
              >
                <Icon name="upload" size={17} />
                Импортировать копию
              </button>
            </div>
            <input
              ref={backupRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Импорт резервной копии"
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <h2>Сохранность данных</h2>
            <p className="settings-paragraph">
              {persistent
                ? 'Браузер разрешил постоянное хранение.'
                : 'Вы можете попросить браузер сохранять данные сайта при нехватке места.'}{' '}
              Очистка данных сайта вручную всё равно удалит файлы.
            </p>
            <button
              className="app-button"
              disabled={persistent === true}
              onClick={async () => {
                if (!navigator.storage?.persist) {
                  services.notify('Этот браузер не поддерживает запрос постоянного хранения');
                  return;
                }
                try {
                  const granted = await navigator.storage.persist();
                  setPersistent(granted);
                  services.notify(
                    granted
                      ? 'Постоянное хранение разрешено'
                      : 'Браузер не предоставил постоянное хранение',
                  );
                } catch (e) {
                  services.notify(errorMessage(e), 'error');
                }
              }}
            >
              {persistent ? 'Постоянное хранение включено' : 'Запросить постоянное хранение'}
            </button>
            <div className="settings-info">
              <Icon name="info" size={20} />
              <p>
                Очистка браузера, режим инкогнито и смена адреса сайта могут сделать текущие файлы
                недоступными. Храните резервную копию важных данных на компьютере.
              </p>
            </div>
          </>
        ) : section === 'system' ? (
          <>
            <h1>Система</h1>
            <p className="settings-intro">Рабочий стол под ваш ритм.</p>
            <h2>Имя пользователя</h2>
            <input
              className="field-input settings-name"
              aria-label="Имя пользователя"
              maxLength={40}
              value={settings.username}
              onChange={(e) => updateSettings({ username: e.target.value || 'Пользователь' })}
            />
            <h2>Сеанс</h2>
            {toggle(
              'Восстанавливать окна',
              'Повторно открывать приложения и положение окон после перезагрузки. Несохранённый текст редактора не восстанавливается.',
              'restoreSession',
            )}
            {toggle('24-часовой формат', 'Показывать время без AM / PM.', 'clock24')}
            {toggle(
              'Секунды на часах',
              'Обновлять часы на панели задач каждую секунду.',
              'showSeconds',
            )}
            <h2>Быстрые действия</h2>
            <div className="settings-actions">
              <button className="app-button" onClick={() => services.openApp('task-manager')}>
                <Icon name="chart" size={17} />
                Диспетчер задач
              </button>
              <button className="app-button" onClick={() => services.openApp('terminal')}>
                <Icon name="terminal" size={17} />
                Терминал
              </button>
            </div>
            <h2>Язык</h2>
            <p className="settings-paragraph">
              Русский · даты и числа форматируются для ru-RU. Сочетания клавиш описаны в «Знакомстве
              с BROwOS».
            </p>
          </>
        ) : section === 'connection' ? (
          <>
            <h1>Три режима. Честные границы.</h1>
            <div className="mode-card">
              <span className="mode-badge">ДОСТУПНО</span>
              <h2>
                <Icon name="computer" />
                Local
              </h2>
              <p>
                Рабочий стол, локальные файлы и приложения работают в браузере. Встроенные сайты
                должны разрешать iframe.
              </p>
            </div>
            <div className="mode-card">
              <span className="mode-badge server">НУЖЕН ВАШ СЕРВЕР</span>
              <h2>
                <Icon name="network" />
                Connected
              </h2>
              <p>
                Настоящий Chromium на вашем сервере. Управление страницей через изображение, мышь и
                клавиатуру. Нужны адрес сервера и токен доступа.
              </p>
              <button className="app-button" onClick={() => services.openApp('browser')}>
                Открыть BROwser
              </button>
              <a
                href="https://github.com/romantic52/BROwOS/blob/main/docs/CONNECTED.md"
                target="_blank"
                rel="noreferrer"
              >
                Инструкция развёртывания
              </a>
            </div>
            <div className="mode-card">
              <span className="mode-badge future">НЕ РЕАЛИЗОВАНО</span>
              <h2>
                <Icon name="desktop" />
                Remote VM
              </h2>
              <p>
                Будущая интеграция с внешней виртуальной машиной. В текущей версии нет подключения к
                Windows VM, запуска .exe и эмуляции процессора.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="settings-about-logo">
              <Icon name="logo" size={65} />
              <h1>BROwOS</h1>
              <p>Browser Operating System</p>
            </div>
            <dl className="about-details">
              <dt>Версия</dt>
              <dd>{VERSION}</dd>
              <dt>Редакция</dt>
              <dd>Local + self-hosted Connected</dd>
              <dt>Интерфейс</dt>
              <dd>Русский</dd>
              <dt>Хранилище</dt>
              <dd>IndexedDB · локальный профиль</dd>
              <dt>Среда</dt>
              <dd>React · TypeScript · Vite</dd>
              <dt>Лицензия</dt>
              <dd>Решение владельца ещё не принято</dd>
            </dl>
            <p className="settings-paragraph">
              BROwOS — самостоятельная браузерная операционная среда, вдохновлённая Windows 10. Не
              является продуктом Microsoft и не заменяет установленную операционную систему.
            </p>
            <a
              className="settings-repo-link"
              href="https://github.com/romantic52/BROwOS"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={17} />
              Исходный код и журнал изменений
            </a>
          </>
        )}
      </main>
    </div>
  );
}
