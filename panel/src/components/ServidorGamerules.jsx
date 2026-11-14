import { useEffect, useState } from 'react';
import { api } from '../api.js';

const GROUPS = { chat: 'Chat', players: 'Jugadores', world: 'Mundo' };

/** Reglas del mundo (/gamerule) con interruptores. */
export default function ServidorGamerules({ rcon }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = () => api.gamerules().then(setData).catch((e) => setMsg({ type: 'error', text: e.message }));
  useEffect(() => { if (rcon) load(); else setData(null); }, [rcon]);

  const flash = (text, type = 'ok') => { setMsg({ text, type }); if (type === 'ok') setTimeout(() => setMsg(null), 3000); };
  const set = async (rule, value) => {
    setBusy(rule.id);
    try {
      const res = await api.cambiarGamerule(rule.id, value);
      setData((d) => ({ ...d, rules: d.rules.map((r) => (r.id === rule.id ? { ...r, value: res.value } : r)) }));
      flash(`${rule.label}: ${typeof res.value === 'boolean' ? (res.value ? 'activado' : 'desactivado') : res.value}`);
    } catch (e) { flash(e.message, 'error'); } finally { setBusy(null); }
  };

  const adminLog = data?.rules?.find((r) => r.id === 'log_admin_commands');
  // Cambios temporales (de bits, recompensas…): cuenta regresiva
  const [temps, setTemps] = useState([]);
  useEffect(() => {
    const tick = () => api.temporalesGamerules().then(setTemps).catch(() => {});
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const endNow = async (t) => {
    try { setTemps(await api.terminarGamerule(t.id)); load(); } catch (e) { flash(e.message, 'error'); }
  };
  const left = (ms) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`; };

  return (
    <details className="card gamerules">
      <summary className="row between">
        <h3 className="no-margin">Reglas del mundo</h3>
        <span className="muted small">{temps.length > 0 ? `⏱ ${temps.length} temporal${temps.length === 1 ? '' : 'es'} activo${temps.length === 1 ? '' : 's'}` : rcon ? 'gamerule' : 'enciende el servidor para cambiarlas'}</span>
      </summary>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}
      {temps.length > 0 && (
        <div className="temp-rules">
          {temps.map((t) => (
            <div key={t.id} className="temp-rule">
              <span>⏱ <strong>{t.label}</strong>: {typeof t.value === 'boolean' ? (t.value ? 'activada' : 'desactivada') : t.value}{t.user ? ` (por ${t.user})` : ''}</span>
              <span className="muted small">{t.otherInstallation ? 'pendiente en otra instalación' : t.remainingMs > 0 ? `vuelve en ${left(t.remainingMs)}` : 'regresando…'}</span>
              <button className="btn small ghost" onClick={() => endNow(t)}>Terminar ya</button>
            </div>
          ))}
        </div>
      )}
      {!rcon && <p className="muted small">Las reglas se leen y se cambian con el servidor encendido.</p>}
      {rcon && !data && <p className="muted small">Cargando…</p>}
      {adminLog?.value && (
        <div className="banner warn target-warn">
          <span>Los comandos que manda la app aparecen en el chat como “[Rcon: …]”.</span>
          <button className="btn small" disabled={busy} onClick={() => set(adminLog, false)}>Ocultarlos</button>
        </div>
      )}
      {data?.rules && Object.entries(GROUPS).map(([g, title]) => {
        const rules = data.rules.filter((r) => r.group === g);
        if (!rules.length) return null;
        return (
          <div key={g} className="gamerule-group">
            <div className="net-label">{title}</div>
            {rules.map((r) => (
              <div key={r.id} className="gamerule-row">
                <div className="grow">
                  <div>{r.label}</div>
                  {r.hint && <div className="muted small">{r.hint}</div>}
                </div>
                <code className="muted small gamerule-name">{r.name}</code>
                {r.type === 'bool' ? (
                  <label className="switch">
                    <input type="checkbox" checked={r.value} disabled={busy === r.id} onChange={(e) => set(r, e.target.checked)} />
                    <span />
                  </label>
                ) : (
                  <input type="number" className="gamerule-num" min={r.min} max={r.max} defaultValue={r.value} key={r.value} disabled={busy === r.id}
                    onBlur={(e) => Number(e.target.value) !== r.value && set(r, Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                )}
              </div>
            ))}
          </div>
        );
      })}
      {data?.rules && (
        <p className="muted small">
          Se guardan en el mundo de la instalación activa (en Paper se aplican al mundo normal, al Nether y al End).
          <button className="btn small ghost" onClick={load}>Volver a leer</button>
        </p>
      )}
    </details>
  );
}
