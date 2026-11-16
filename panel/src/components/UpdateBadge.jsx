import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Versión de la app y aviso cuando hay una actualización descargada. */
export default function UpdateBadge() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    const load = () => api.version().then(setInfo).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (!info?.current) return null;

  const install = async () => {
    if (!confirm(`¿Reiniciar ahora para actualizar a la versión ${info.newVersion}?\n\nSe apaga el servidor de Minecraft guardando el mundo, se instala la actualización y la app se vuelve a abrir.`)) return;
    setBusy(true);
    try { await api.actualizar(); } catch (e) { alert(e.message); setBusy(false); }
  };
  // Al buscar a mano se dice qué pasó (antes no se veía nada si había un error)
  const check = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await api.buscarActualizacion();
      const next = { ...info, state: res.state, newVersion: res.version ?? res.newVersion, progress: res.progress, error: res.error };
      setInfo(next);
      setNote(res.state === 'none' ? 'Ya tienes la última versión.'
        : res.state === 'downloading' || res.state === 'ready' ? `Hay una versión nueva: ${next.newVersion}.`
          : res.state === 'error' ? `No se pudo buscar: ${String(res.error ?? '').split('\n')[0].slice(0, 140)}` : null);
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };

  if (info.state === 'ready') {
    return (
      <div className="update-box">
        <strong>Versión {info.newVersion} lista</strong>
        <span className="muted small">Se instala al salir, o ahora:</span>
        <button className="btn small primary" onClick={install} disabled={busy}>{busy ? 'Reiniciando…' : '⬆ Reiniciar y actualizar'}</button>
      </div>
    );
  }
  return (
    <div className="app-version muted small">
      {info.state === 'downloading' ? `Descargando ${info.newVersion}… ${info.progress ?? 0}%` : `v${info.current}${info.packaged ? '' : ' (desarrollo)'}`}
      {info.packaged && info.state !== 'downloading' && (
        <button className="link-btn" onClick={check} disabled={busy} title={info.error ? `Último error: ${info.error}` : 'Buscar actualizaciones'}>
          {busy || info.state === 'checking' ? 'buscando…' : 'buscar'}
        </button>
      )}
      {note && <div className="update-note" onClick={() => setNote(null)}>{note}</div>}
    </div>
  );
}
