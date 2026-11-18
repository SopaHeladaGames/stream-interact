import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Inicio from './pages/Inicio.jsx';
import Reglas from './pages/Reglas.jsx';
import Probar from './pages/Probar.jsx';
import Recompensas from './pages/Recompensas.jsx';
import Servidor from './pages/Servidor.jsx';
import Instalaciones from './pages/Instalaciones.jsx';
import Estadisticas from './pages/Estadisticas.jsx';
import ChatPanel from './pages/Chat.jsx';
import Votaciones from './pages/Votaciones.jsx';
import Caos from './pages/Caos.jsx';
import Overlay from './pages/Overlay.jsx';
import Donaciones from './pages/Donaciones.jsx';
import PollWidget from './components/PollWidget.jsx';
import UpdateBadge from './components/UpdateBadge.jsx';

const PAGES = [
  { id: 'inicio', label: 'Inicio', icon: '◉' },
  { id: 'reglas', label: 'Reglas', icon: '⚙' },
  { id: 'votaciones', label: 'Votaciones', icon: '☰' },
  { id: 'caos', label: 'Modo caos', icon: '⚡' },
  { id: 'overlay', label: 'Overlay OBS', icon: '▢' },
  { id: 'donaciones', label: 'Donaciones', icon: '$' },
  { id: 'probar', label: 'Probar', icon: '▶' },
  { id: 'estadisticas', label: 'Estadísticas', icon: '▥' },
  { id: 'servidor', label: 'Servidor', icon: '▣' },
  { id: 'instalaciones', label: 'Instalaciones', icon: '▤' },
  { id: 'recompensas', label: 'Recompensas', icon: '★' }
];

const CHAT_MIN = 280;
const CHAT_MAX = 640;

// Preferencias de la vista guardadas en este equipo (si el almacenamiento falla, se usan los valores por defecto)
const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
};

export default function App() {
  const [page, setPage] = useState(() => {
    const hash = location.hash.slice(1);
    return PAGES.some((p) => p.id === hash) ? hash : 'inicio';
  });
  const [estado, setEstado] = useState(null);
  const [offline, setOffline] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => load('chatOpen', true));
  const [chatWidth, setChatWidth] = useState(() => load('chatWidth', 380));
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => { location.hash = page; }, [page]);
  useEffect(() => save('chatOpen', chatOpen), [chatOpen]);
  useEffect(() => save('chatWidth', chatWidth), [chatWidth]);

  // El estado se consulta cada 2 s: conexiones, pausa y cola
  useEffect(() => {
    let alive = true;
    const tick = () => api.estado()
      .then((e) => { if (alive) { setEstado(e); setOffline(false); } })
      .catch(() => alive && setOffline(true));
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Arrastrar el borde izquierdo del chat para cambiar su ancho
  const startResize = (e) => {
    e.preventDefault();
    dragRef.current = { x: e.clientX, width: chatWidth };
    setResizing(true);
    const move = (ev) => {
      const next = dragRef.current.width + (dragRef.current.x - ev.clientX);
      setChatWidth(Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, next))));
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // La votación se muestra sobre el chat mientras está activa y unos segundos después (resultado)
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const changeProfile = async (id) => {
    setSwitchingProfile(true);
    try {
      const r = await api.activarPerfil(id || null);
      setEstado((e) => (e ? { ...e, profile: e.profiles.find((p) => p.id === r.active) ?? null } : e));
      if (r.failed?.length) alert(`No se pudieron cambiar: ${r.failed.map((f) => f.title).join(', ')}`);
    } catch (err) { alert(err.message); } finally { setSwitchingProfile(false); }
  };

  const pollLive = Boolean(estado?.poll?.active)
    || (estado?.poll?.lastEndedAt != null && Date.now() - new Date(estado.poll.lastEndedAt).getTime() < 20000);

  const togglePause = async () => {
    const next = estado?.paused ? await api.reanudar() : await api.pausa();
    setEstado((e) => ({ ...e, ...next }));
  };

  return (
    <div
      className={`layout ${chatOpen ? 'with-chat' : ''} ${resizing ? 'resizing' : ''}`}
      style={{ '--chat-width': `${chatWidth}px` }}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Sopa-ChatBot
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
              <span className="nav-icon">{p.icon}</span>{p.label}
              {p.id === 'caos' && estado?.chaos?.running && <span className="nav-live" title="Modo caos activo" />}
              {p.id === 'votaciones' && estado?.poll?.active && <span className="nav-live" title="Votación en curso" />}
              {p.id === 'donaciones' && Object.values(estado?.donations ?? {}).some((d) => d === 'error') && <span className="nav-live error" title="Un servicio de donaciones tiene un error" />}
              {p.id === 'donaciones' && !Object.values(estado?.donations ?? {}).some((d) => d === 'error') && Object.values(estado?.donations ?? {}).some((d) => d === 'connected' || d === 'listening') && <span className="nav-live ok" title="Donaciones conectadas" />}
            </button>
          ))}
        </nav>
        {estado?.profiles?.length > 0 && (
          <label className="profile-switch" title="Perfil de juego: enciende sus reglas y recompensas y apaga las de los demás">
            <span>🎮 Perfil</span>
            <select value={estado.profile?.id ?? ''} disabled={switchingProfile} onChange={(e) => changeProfile(e.target.value)}>
              <option value="">Ninguno</option>
              {estado.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <button
          className={`panic ${estado?.paused ? 'paused' : ''}`}
          onClick={togglePause}
          disabled={!estado}
          title="También puedes usar !pausa / !reanudar en el chat"
        >
          {estado?.paused ? '▶ Reanudar' : '⏸ Pausar todo'}
        </button>
        <UpdateBadge />
      </aside>

      <main className="content">
        {offline && (
          <div className="banner error">
            No hay conexión con la app. ¿Está corriendo <code>npm start</code>?
          </div>
        )}
        {page === 'inicio' && <Inicio estado={estado} />}
        {page === 'reglas' && <Reglas />}
        {page === 'votaciones' && <Votaciones />}
        {page === 'caos' && <Caos />}
        {page === 'overlay' && <Overlay />}
        {page === 'donaciones' && <Donaciones />}
        {page === 'probar' && <Probar />}
        {page === 'servidor' && <Servidor go={setPage} />}
        {page === 'instalaciones' && <Instalaciones go={setPage} />}
        {page === 'estadisticas' && <Estadisticas />}
        {page === 'recompensas' && <Recompensas conectado={estado?.twitch?.connected} />}
      </main>

      {chatOpen ? (
        <aside className="chat-aside">
          <div className="chat-resizer" onMouseDown={startResize} onDoubleClick={() => setChatWidth(380)} title="Arrastra para cambiar el ancho (doble clic: tamaño normal)" />
          <ChatPanel
            conectado={estado?.twitch?.connected}
            canal={estado?.twitch?.user}
            loginUrl={estado?.twitch?.loginUrl}
            onClose={() => setChatOpen(false)}
            top={<PollWidget live={pollLive} />}
          />
        </aside>
      ) : (
        <button className="chat-tab" onClick={() => setChatOpen(true)} title="Mostrar el chat">
          <span>‹</span> Chat
        </button>
      )}
    </div>
  );
}
