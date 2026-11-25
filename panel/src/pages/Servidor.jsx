import { useEffect, useRef, useState } from 'react';
import { api, subscribeConsole } from '../api.js';
import ServidorJugadores from '../components/ServidorJugadores.jsx';
import ServidorRespaldos from '../components/ServidorRespaldos.jsx';
import ServidorGamerules from '../components/ServidorGamerules.jsx';
import ServidorDistancia from '../components/ServidorDistancia.jsx';

const STATE = {
  stopped: { label: 'Detenido', dot: 'off' },
  starting: { label: 'Iniciando…', dot: 'warn' },
  running: { label: 'En línea', dot: 'ok' },
  stopping: { label: 'Deteniendo…', dot: 'warn' },
  crashed: { label: 'Se cayó', dot: 'off' },
  external: { label: 'Corriendo fuera de la app', dot: 'ok' }
};

export default function Servidor({ go }) {
  const [status, setStatus] = useState(null);
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [installs, setInstalls] = useState(null);
  const consoleRef = useRef(null);
  const historyRef = useRef({ list: [], index: -1 });

  useEffect(() => {
    let alive = true;
    const tick = () => api.servidor().then((s) => alive && setStatus(s)).catch(() => {});
    tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => { api.instalaciones().then(setInstalls).catch(() => {}); }, [status?.installation?.id]);

  const switchTo = async (id) => {
    setBusy(true); setError(null);
    try { setInstalls(await api.activarInstalacion(id)); setStatus(await api.servidor()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  useEffect(() => subscribeConsole((entry) =>
    setLines((l) => (l.some((e) => e.id === entry.id) ? l : [...l, entry].slice(-1000)))), []);

  useEffect(() => {
    if (autoScroll && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [lines.length, autoScroll]);

  const run = (fn) => async () => {
    setBusy(true); setError(null);
    try { setStatus({ ...(await fn()), rcon: status?.rcon }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const send = async (e) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;
    const h = historyRef.current;
    h.list = [cmd, ...h.list.filter((c) => c !== cmd)].slice(0, 50);
    h.index = -1;
    setCommand('');
    try { await api.comandoServidor(cmd); } catch (err) { setError(err.message); }
  };

  // ↑ / ↓ recorren los comandos anteriores, como en una terminal
  const onKeyDown = (e) => {
    const h = historyRef.current;
    if (e.key === 'ArrowUp' && h.index < h.list.length - 1) { h.index++; setCommand(h.list[h.index]); e.preventDefault(); }
    if (e.key === 'ArrowDown') { h.index = Math.max(-1, h.index - 1); setCommand(h.index === -1 ? '' : h.list[h.index]); e.preventDefault(); }
  };

  const s = status?.state ?? 'stopped';
  const info = STATE[s] ?? STATE.stopped;
  const owned = ['starting', 'running', 'stopping'].includes(s);
  const canSend = owned || (s === 'external' && status?.rcon);

  return (
    <>
      <div className="section-head">
        <h1>Servidor de Minecraft</h1>
        <div className="row gap">
          <button className="btn primary" onClick={run(api.iniciarServidor)} disabled={busy || !status?.configured || owned || s === 'external'}>▶ Iniciar</button>
          <button className="btn" onClick={run(api.reiniciarServidor)} disabled={busy || s !== 'running'}>↻ Reiniciar</button>
          <button className="btn danger" onClick={run(api.detenerServidor)} disabled={busy || !owned || s === 'stopping'}>■ Detener</button>
        </div>
      </div>

      <div className="install-bar">
        <span className="muted small">Instalación</span>
        {installs?.items?.length > 0 ? (
          <select className="install-select" value={installs.active ?? ''} disabled={busy || owned || s === 'external'}
            title={owned || s === 'external' ? 'Detén el servidor para cambiar de instalación' : 'Instalación que se arranca'}
            onChange={(e) => switchTo(e.target.value)}>
            {installs.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.info.label}{i.info.version ? ` ${i.info.version}` : ''}</option>)}
          </select>
        ) : <span className="muted small">ninguna</span>}
        <button className="btn small ghost" onClick={() => go?.('instalaciones')}>Administrar instalaciones</button>
        {(owned || s === 'external') && <span className="muted small">Detén el servidor para cambiar de instalación.</span>}
      </div>

      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {status && !status.configured && (
        <div className="banner warn">
          Para controlar el servidor desde aquí, agrega la carpeta de tu servidor en{' '}
          <a href="#instalaciones" onClick={(e) => { e.preventDefault(); go?.('instalaciones'); }}>Instalaciones</a>.
        </div>
      )}
      {s === 'external' && (
        <div className="banner warn">
          Hay un servidor corriendo que no arrancó la app (probablemente con <code>start.bat</code>).
          Puedes mandarle comandos por RCON, pero para verlo y controlarlo aquí, ciérralo con <code>stop</code> y dale ▶ Iniciar.
        </div>
      )}

      <div className="cards">
        <div className="card status">
          <div className="row between"><span className="card-title">Estado</span><span className={`dot ${info.dot}`} /></div>
          <div className="card-detail">{info.label}</div>
        </div>
        <div className="card status">
          <div className="row between"><span className="card-title">RCON</span><span className={`dot ${status?.rcon ? 'ok' : 'off'}`} /></div>
          <div className="card-detail">{status?.rcon ? 'Conectado' : 'Sin conexión'}</div>
        </div>
        <div className="card status">
          <div className="row between"><span className="card-title">Activo desde</span></div>
          <div className="card-detail">{owned && status?.startedAt ? new Date(status.startedAt).toLocaleTimeString('es-MX', { hour12: false }) : '—'}</div>
        </div>
        <div className="card status">
          <div className="row between"><span className="card-title">Reinicio automático</span><span className={`dot ${status?.autoRestart ? 'ok' : 'off'}`} /></div>
          <div className="card-detail">{status?.autoRestart ? 'Si se cae, se levanta en 10 s' : 'Desactivado'}</div>
        </div>
      </div>

      <ServidorJugadores rcon={Boolean(status?.rcon)} />

      <ServidorRespaldos serverState={s} />

      <ServidorGamerules rcon={Boolean(status?.rcon)} />

      <ServidorDistancia serverState={s} />

      <div className="section-head">
        <h2>Consola</h2>
        <div className="row gap">
          <label className="check"><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Seguir</label>
          <button className="btn ghost small" onClick={() => setLines([])}>Limpiar</button>
        </div>
      </div>
      <div className="console" ref={consoleRef}>
        {lines.length === 0 && <div className="empty">La consola aparece aquí cuando el servidor se inicia desde la app.</div>}
        {lines.map((l) => <div key={l.id} className={`con-line con-${l.stream} ${/WARN/.test(l.text) ? 'con-warn' : ''} ${/ERROR|FATAL|fatal error/.test(l.text) ? 'con-error' : ''}`}>{l.text}</div>)}
      </div>
      <form className="console-input" onSubmit={send}>
        <span className="prompt">&gt;</span>
        <input
          className="mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canSend ? 'Escribe un comando (ej. whitelist add Nombre, time set day)…' : 'El servidor no está corriendo'}
          disabled={!canSend}
        />
        <button className="btn" disabled={!canSend || !command.trim()}>Enviar</button>
      </form>
    </>
  );
}
