import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function Bootstrap() {
  const [opened, setOpened] = React.useState(true);
  const [start, setStart] = React.useState(false);
  return <main className="bootstrap-desktop">
    <div className="bootstrap-brand"><span>▦</span><h1>BROwOS</h1><p>Ваш рабочий стол. Теперь в браузере.</p></div>
    {opened && <section className="bootstrap-window"><header><strong>BROwOS</strong><button onClick={() => setOpened(false)} aria-label="Закрыть">×</button></header><article><h2>Добро пожаловать домой.</h2><p>Рабочее пространство для ваших идей, файлов и приложений.</p><p>Версия 0.1.0 · Инициализация среды</p><button onClick={() => setOpened(false)}>Открыть рабочий стол</button></article></section>}
    {start && <aside className="bootstrap-start"><h2>BROwOS</h2><button onClick={() => {setOpened(true); setStart(false);}}>О системе</button></aside>}
    <footer className="bootstrap-taskbar"><button aria-label="Пуск" onClick={() => setStart(!start)}>▦</button><button onClick={() => setOpened(true)}>BROwOS</button><span>Local · {new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Bootstrap /></React.StrictMode>);
