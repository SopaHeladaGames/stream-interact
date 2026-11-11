import { useEffect, useRef, useState } from 'react';
import { api, subscribeFeed } from '../api.js';

const LEVEL_LABEL = { event: 'Evento', action: 'Acción', warn: 'Aviso', error: 'Error', info: 'Info' };
const SERVER_LABEL = { stopped: 'Detenido', starting: 'Iniciando…', running: 'En línea (desde la app)', stopping: 'Deteniendo…', crashed: 'Se cayó', external: 'En línea (fuera de la app)' };
const FILTERS = [
  { id: 'todo', label: 'Todo' },
  { id: 'event', label: 'Eventos' },
  { id: 'action', label: 'Acciones' },
  { id: 'problemas', label: 'Avisos y errores' }
];

export default function Inicio({ estado }) {
  const [feed, setFeed] = useState([]);
  const [filter, setFilter] = useState('todo');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef(null);

  useEffect(() => subscribeFeed((entry) =>
    setFeed((f) => (f.some((e) => e.id === entry.id) ? f : [...f, entry].slice(-300)))), []);

  const visible = feed.filter((e) =>
    filter === 'todo' || (filter === 'problemas' ? e.level === 'warn' || e.level === 'error' : e.level === filter));

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [visible.length, autoScroll]);

  const tw = estado?.twitch;
  const mc = estado?.minecraft;

  return (
    <>
      <h1>Inicio</h1>
      <div className="cards">
        <StatusCard
          title="Twitch"
          ok={tw?.connected}
          detail={tw?.connected ? `Conectado como ${tw.user}` : 'Sin conectar'}
          action={!tw?.connected && tw?.loginUrl && <a className="btn small" href={tw.loginUrl}>Conectar</a>}
        />
        <StatusCard
          title="Minecraft"
          ok={mc?.connected}
          detail={mc ? `${mc.connected ? 'RCON conectado' : 'Sin conexión'} · ${mc.host}` : '…'}
          action={!mc?.connected && <button className="btn small" onClick={() => api.conectarMinecraft().catch(() => {})}>Reconectar</button>}
        />
        <StatusCard
          title="Servidor"
          ok={['running', 'external'].includes(estado?.server?.state)}
          warn={['starting', 'stopping'].includes(estado?.server?.state)}
          detail={SERVER_LABEL[estado?.server?.state] ?? '…'}
        />
        <StatusCard
          title="Interacciones"
          ok={estado && !estado.paused}
          warn={estado?.paused}
          detail={estado ? (estado.paused ? 'En pausa' : `Activas · ${estado.pending} en cola`) : '…'}
        />
        <StatusCard title="Reglas activas" ok detail={estado ? `${estado.rules} reglas` : '…'} />
      </div>

      <div className="section-head">
        <h2>Actividad en vivo</h2>
        <div className="row gap">
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Seguir</label>
          <button className="btn ghost small" onClick={() => setFeed([])}>Limpiar</button>
        </div>
      </div>
      <div className="feed" ref={listRef}>
        {visible.length === 0 && <div className="empty">Aún no hay actividad. Prueba un comando en tu chat o en la sección Probar.</div>}
        {visible.map((e) => (
          <div key={e.id} className={`feed-row lvl-${e.level}`}>
            <span className="feed-time">{new Date(e.at).toLocaleTimeString('es-MX', { hour12: false })}</span>
            <span className={`tag tag-${e.level}`}>{LEVEL_LABEL[e.level] ?? e.level}</span>
            <span className="feed-text">{e.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function StatusCard({ title, ok, warn, detail, action }) {
  const state = warn ? 'warn' : ok ? 'ok' : 'off';
  return (
    <div className="card status">
      <div className="row between">
        <span className="card-title">{title}</span>
        <span className={`dot ${state}`} />
      </div>
      <div className="card-detail">{detail}</div>
      {action && <div className="card-action">{action}</div>}
    </div>
  );
}
