import { useEffect, useState } from 'react';
import { api } from '../api.js';

const ago = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
};

/** Pestaña "Recompensas" del chat: la lista del canal para pausar, activar o probar sin cambiar de página. */
export function ChatRewardList({ flash }) {
  const [rewards, setRewards] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.recompensas().then((r) => { setRewards(r); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  const patch = async (r, p, ok) => {
    setBusy(r.id);
    try { await api.actualizarRecompensa(r.id, p); await load(); flash(ok); } catch (e) { flash(e.message, 'error'); } finally { setBusy(null); }
  };
  const test = async (r) => {
    try { await api.simular({ type: 'reward', name: r.title, user: 'Tester', amount: r.cost }); flash(`Probando “${r.title}”`); } catch (e) { flash(e.message, 'error'); }
  };

  if (error) return <div className="side-empty">{error}</div>;
  if (!rewards) return <div className="side-empty">Cargando…</div>;
  if (!rewards.length) return <div className="side-empty">No hay recompensas. Créalas en la página Recompensas.</div>;

  const sorted = [...rewards].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.cost - b.cost);
  return (
    <div className="side-list">
      {sorted.map((r) => {
        const locked = !r.managedByApp;
        return (
          <div key={r.id} className={`side-reward ${!r.enabled ? 'off' : ''}`}>
            <span className="side-reward-color" style={{ background: r.backgroundColor || 'var(--accent-2)' }} />
            <div className="side-reward-main">
              <div className="side-reward-title">{r.title}</div>
              <div className="muted small">
                {r.cost.toLocaleString('es-MX')} pts
                {!r.enabled ? ' · desactivada' : r.paused ? ' · pausada' : ''}
                {locked && ' · de Twitch'}
              </div>
            </div>
            <div className="side-reward-actions">
              <button className="tool" title="Probar (como si alguien la canjeara)" onClick={() => test(r)}>▶</button>
              {r.enabled && (
                <button className={`tool ${r.paused ? 'warn-on' : ''}`} disabled={locked || busy === r.id}
                  title={locked ? 'Solo se puede cambiar en Twitch' : r.paused ? 'Reanudar canjes' : 'Pausar canjes'}
                  onClick={() => patch(r, { isPaused: !r.paused }, r.paused ? `“${r.title}” reanudada` : `“${r.title}” pausada`)}>
                  {r.paused ? '▶︎' : <span className="pause-glyph">❚❚</span>}
                </button>
              )}
              <label className={`switch small-switch ${locked ? 'locked' : ''}`} title={locked ? 'Solo se puede cambiar en Twitch' : r.enabled ? 'Desactivar' : 'Activar'}>
                <input type="checkbox" checked={r.enabled} disabled={locked || busy === r.id}
                  onChange={() => patch(r, { isEnabled: !r.enabled }, r.enabled ? `“${r.title}” desactivada` : `“${r.title}” activada`)} />
                <span />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pestaña "Canjes": lo pendiente arriba (completar / devolver) y lo reciente abajo. */
export function ChatRedemptions({ flash, onCount }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => api.canjes().then((d) => { setData(d); onCount?.(d.pending.length); }).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, []);

  const resolve = async (r, action) => {
    if (action === 'devolver' && !confirm(`¿Devolverle ${r.cost.toLocaleString('es-MX')} puntos a ${r.user}?`)) return;
    setBusy(r.id);
    try {
      await api.resolverCanje(r.id, action);
      flash(action === 'devolver' ? `Puntos devueltos a ${r.user}` : `“${r.title}” de ${r.user}: hecho`);
      await load();
    } catch (e) { flash(e.message, 'error'); } finally { setBusy(null); }
  };

  if (!data) return <div className="side-empty">Cargando…</div>;

  return (
    <div className="side-list">
      <div className="side-section">Pendientes ({data.pending.length})</div>
      {data.pending.length === 0 && <div className="side-empty small">Nada pendiente. Los canjes con regla se completan solos.</div>}
      {data.pending.map((r) => (
        <div key={r.id} className="side-redemption pending">
          <div className="side-reward-main">
            <div><strong>{r.user}</strong> · {r.title}</div>
            {r.input && <div className="side-input">“{r.input}”</div>}
            <div className="muted small">{ago(r.at)} · {r.cost.toLocaleString('es-MX')} pts{!r.managed && ' · de Twitch'}</div>
          </div>
          <div className="side-redemption-actions">
            {r.managed ? (
              <>
                <button className="btn small primary" disabled={busy === r.id} onClick={() => resolve(r, 'completar')} title="Marcar como cumplido en Twitch">✓</button>
                <button className="btn small ghost danger" disabled={busy === r.id} onClick={() => resolve(r, 'devolver')} title="Devolver los puntos">↩</button>
              </>
            ) : (
              <button className="btn small" disabled={busy === r.id} onClick={() => resolve(r, 'visto')} title="Quitar de pendientes (en Twitch se maneja desde su cola)">✓</button>
            )}
          </div>
        </div>
      ))}

      {data.recent.length > 0 && <div className="side-section">Recientes</div>}
      {data.recent.slice(0, 30).map((r) => (
        <div key={r.id} className="side-redemption">
          <div className="side-reward-main">
            <div><strong>{r.user}</strong> · {r.title}</div>
            {r.input && <div className="side-input">“{r.input}”</div>}
          </div>
          <span className={`pill ${r.status === 'devuelto' ? 'warn' : 'ok'}`} title={r.by === 'regla' ? 'Por una regla' : 'Desde el panel'}>
            {r.status === 'devuelto' ? 'devuelto' : 'hecho'}
          </span>
        </div>
      ))}
    </div>
  );
}
