import { useEffect, useState } from 'react';
import { api } from '../api.js';

const INTERVALS = [0.5, 1, 2, 3, 4, 6, 12, 24];
const REASON_CLASS = { auto: 'off', 'al-detener': 'off', manual: 'ok', 'antes-de-restaurar': 'warn' };

const mb = (bytes) => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`);
const when = (iso) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const hours = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h ${min % 60} min` : `hace ${Math.floor(h / 24)} días`;
}

/** Respaldos del mundo de la instalación activa. */
export default function ServidorRespaldos({ serverState }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [dirDraft, setDirDraft] = useState(null);

  const load = () => api.respaldos().then(setData).catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const flash = (text, type = 'ok') => { setMsg({ text, type }); if (type === 'ok') setTimeout(() => setMsg(null), 5000); };
  const act = async (fn, ok) => {
    try { const res = await fn(); if (res?.list) setData((d) => ({ ...d, ...res })); else load(); if (ok) flash(ok); }
    catch (e) { flash(e.message, 'error'); load(); }
  };
  const save = (patch) => act(() => api.ajustesRespaldos(patch));

  if (!data) return null;
  const { settings, list, busy } = data;
  const stopped = ['stopped', 'crashed'].includes(serverState);
  const shown = showAll ? list : list.slice(0, 6);

  const backupNow = () => {
    setData((d) => ({ ...d, busy: { kind: 'backup', reason: 'manual', since: new Date().toISOString() } }));
    act(() => api.respaldarAhora(), 'Respaldo listo.');
  };

  const restore = (b) => {
    if (!confirm(`¿Restaurar el mundo al ${when(b.at)}?\n\nEl mundo actual se reemplaza por el de ese respaldo. Antes se guarda una copia del mundo actual ("Antes de restaurar") por si quieres regresar.\n\nLa lista blanca y la configuración no cambian.`)) return;
    setData((d) => ({ ...d, busy: { kind: 'restore', file: b.file, since: new Date().toISOString() } }));
    act(() => api.restaurarRespaldo(b.file), 'Mundo restaurado. Ya puedes iniciar el servidor.');
  };

  const remove = (b) => confirm(`¿Borrar el respaldo del ${when(b.at)}? No se puede deshacer.`) && act(() => api.borrarRespaldo(b.file));

  const pickDir = async () => {
    try { const { dir } = await api.elegirCarpetaRespaldos(); if (dir) setDirDraft(dir); } catch (e) { flash(e.message, 'error'); }
  };

  return (
    <div className="card">
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}
      <div className="row between wrap gap">
        <div className="row gap">
          <h3 className="no-margin">Respaldos</h3>
          {data.installation && <span className="muted small">de “{data.installation.name}”</span>}
        </div>
        <div className="row gap">
          {data.canOpen && <button className="btn small ghost" onClick={() => act(() => api.abrirCarpetaRespaldos())}>Abrir carpeta</button>}
          <button className="btn small primary" onClick={backupNow} disabled={Boolean(busy) || !data.installation || serverState === 'stopping'}>
            {busy?.kind === 'backup' ? 'Respaldando…' : '💾 Respaldar ahora'}
          </button>
        </div>
      </div>

      <div className="backup-summary">
        <label className="switch" title={settings.enabled ? 'Desactivar respaldos automáticos' : 'Activar respaldos automáticos'}>
          <input type="checkbox" checked={settings.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <span />
        </label>
        <span className="small">
          {settings.enabled
            ? <>Automáticos cada <strong>{hours(settings.intervalHours)}</strong> con el servidor encendido{settings.onStop && <> y <strong>al detenerlo</strong></>}. Se conservan los últimos <strong>{settings.keep}</strong>.</>
            : 'Respaldos automáticos desactivados. Solo se respalda cuando le das a “Respaldar ahora”.'}
        </span>
      </div>
      <div className="muted small backup-status">
        {busy?.kind === 'backup' && <span className="pill warn">Respaldando… no apagues la PC</span>}
        {busy?.kind === 'restore' && <span className="pill warn">Restaurando…</span>}
        {list[0] && <span>Último: {ago(list[0].at)}</span>}
        {data.nextAt && !busy && <span>Próximo: {new Date(data.nextAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
        {list.length > 0 && <span>{list.length} respaldos · {mb(data.totalSize)}</span>}
      </div>
      {data.lastError && <div className="install-problem">⚠ Último error: {data.lastError.message}</div>}

      {list.length === 0 && !busy && <p className="muted small">Todavía no hay respaldos de esta instalación.</p>}
      {list.length > 0 && (
        <div className="backup-list">
          {shown.map((b) => (
            <div key={b.file} className="backup-row">
              <span className="backup-when">{when(b.at)}</span>
              <span className={`pill ${REASON_CLASS[b.reason] ?? 'off'}`}>{b.reasonLabel}</span>
              <span className="muted small grow">{mb(b.size)}</span>
              <button className="btn small ghost" disabled={!stopped || Boolean(busy)} title={stopped ? 'Regresar el mundo a este respaldo' : 'Detén el servidor para restaurar'} onClick={() => restore(b)}>Restaurar</button>
              <button className="icon-btn danger" title="Borrar este respaldo" disabled={Boolean(busy)} onClick={() => remove(b)}>✕</button>
            </div>
          ))}
          {list.length > 6 && <button className="btn small ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Ver menos' : `Ver los ${list.length}`}</button>}
          {!stopped && <p className="muted small">Para restaurar un respaldo primero detén el servidor.</p>}
        </div>
      )}

      <details className="small-details backup-settings">
        <summary className="muted small">Ajustes de respaldos</summary>
        <div className="field-row">
          <label className="field narrow">
            <span>Cada</span>
            <select value={settings.intervalHours} onChange={(e) => save({ intervalHours: Number(e.target.value) })}>
              {[...new Set([...INTERVALS, settings.intervalHours])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{hours(h)}</option>)}
            </select>
          </label>
          <label className="field narrow">
            <span>Conservar automáticos</span>
            <input type="number" min="1" max="200" defaultValue={settings.keep} key={settings.keep}
              onBlur={(e) => Number(e.target.value) !== settings.keep && save({ keep: Number(e.target.value) })} />
          </label>
          <label className="check align-end">
            <input type="checkbox" checked={settings.onStop} onChange={(e) => save({ onStop: e.target.checked })} /> Respaldar al detener el servidor
          </label>
        </div>
        <div className="field-row">
          <label className="field grow">
            <span>Carpeta de respaldos</span>
            <input value={dirDraft ?? settings.dir} onChange={(e) => setDirDraft(e.target.value)} placeholder="Junto a tu servidor, en mc-backups (predeterminada)" />
          </label>
          {data.canPick && <button className="btn align-end" onClick={pickDir}>Examinar…</button>}
          {dirDraft !== null && dirDraft !== settings.dir && (
            <button className="btn primary align-end" onClick={() => { save({ dir: dirDraft }); setDirDraft(null); }}>Guardar</button>
          )}
        </div>
        <p className="muted small">
          Ahora se guardan en <code>{data.folder}</code>. Los manuales y los “Antes de restaurar” no se borran solos.
          Si tienes otro disco, guardarlos ahí te protege si falla el principal.
        </p>
      </details>
    </div>
  );
}
