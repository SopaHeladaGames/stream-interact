import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Versión de la app y aviso cuando hay una actualización descargada. */
export default function UpdateBadge() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

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
  const check = async () => { setBusy(true); try { setInfo({ ...info, ...(await api.buscarActualizacion()) }); } finally { setBusy(false); } };

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
    </div>
  );
}
