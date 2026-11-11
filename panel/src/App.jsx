import { useEffect, useState } from 'react';
import { api } from './api.js';
import Inicio from './pages/Inicio.jsx';
import Reglas from './pages/Reglas.jsx';
import Probar from './pages/Probar.jsx';
import Recompensas from './pages/Recompensas.jsx';
import Servidor from './pages/Servidor.jsx';

const PAGES = [
  { id: 'inicio', label: 'Inicio', icon: '◉' },
  { id: 'reglas', label: 'Reglas', icon: '⚙' },
  { id: 'probar', label: 'Probar', icon: '▶' },
  { id: 'servidor', label: 'Servidor', icon: '▣' },
  { id: 'recompensas', label: 'Recompensas', icon: '★' }
];

export default function App() {
  const [page, setPage] = useState(() => location.hash.slice(1) || 'inicio');
  const [estado, setEstado] = useState(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => { location.hash = page; }, [page]);

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

  const togglePause = async () => {
    const next = estado?.paused ? await api.reanudar() : await api.pausa();
    setEstado((e) => ({ ...e, ...next }));
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          stream-interact
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
              <span className="nav-icon">{p.icon}</span>{p.label}
            </button>
          ))}
        </nav>
        <button
          className={`panic ${estado?.paused ? 'paused' : ''}`}
          onClick={togglePause}
          disabled={!estado}
          title="También puedes usar !pausa / !reanudar en el chat"
        >
          {estado?.paused ? '▶ Reanudar' : '⏸ Pausar todo'}
        </button>
      </aside>

      <main className="content">
        {offline && (
          <div className="banner error">
            No hay conexión con la app. ¿Está corriendo <code>npm start</code>?
          </div>
        )}
        {page === 'inicio' && <Inicio estado={estado} />}
        {page === 'reglas' && <Reglas />}
        {page === 'probar' && <Probar />}
        {page === 'servidor' && <Servidor />}
        {page === 'recompensas' && <Recompensas conectado={estado?.twitch?.connected} />}
      </main>
    </div>
  );
}
