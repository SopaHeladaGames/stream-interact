import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Distancia de visión y de simulación del servidor (server.properties). Se aplican al iniciarlo. */
export default function ServidorDistancia({ serverState }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.distancia().then((d) => { setData(d); setForm({ viewDistance: d.viewDistance, simulationDistance: d.simulationDistance }); })
    .catch((e) => setMsg({ type: 'error', text: e.message }));
  useEffect(() => { load(); }, [serverState]);

  if (!data || !form) return null;

  const dirty = form.viewDistance !== data.viewDistance || form.simulationDistance !== data.simulationDistance;
  const pending = data.running && data.applied
    && (data.applied.viewDistance !== data.viewDistance || data.applied.simulationDistance !== data.simulationDistance);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await api.guardarDistancia(form);
      setData(d); setForm({ viewDistance: d.viewDistance, simulationDistance: d.simulationDistance });
      if (!d.running) setMsg({ type: 'ok', text: 'Guardado. Se usará la próxima vez que inicies el servidor.' });
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  const restart = async () => {
    if (!confirm('¿Reiniciar el servidor para aplicar la nueva distancia?\n\nLos jugadores se desconectan unos segundos y pueden volver a entrar.')) return;
    setBusy(true);
    try { await api.reiniciarServidor(); setMsg({ type: 'ok', text: 'Reiniciando el servidor…' }); } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  const heavy = form.viewDistance > 16 || form.simulationDistance > 12;

  return (
    <details className="card distance-card">
      <summary className="row between">
        <h3 className="no-margin">Distancia de visión</h3>
        <span className="muted small">
          {pending ? '⟳ reinicia para aplicar' : `ver ${data.viewDistance} · simular ${data.simulationDistance} chunks`}
        </span>
      </summary>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}
      {pending && (
        <div className="banner warn row between gap">
          <span>
            Guardado, pero el servidor sigue usando visión {data.applied.viewDistance} y simulación {data.applied.simulationDistance} hasta que lo reinicies.
          </span>
          <button className="btn small" onClick={restart} disabled={busy}>⟳ Reiniciar ahora</button>
        </div>
      )}
      <div className="distance-grid">
        <label className="slider">
          <span className="slider-head"><span>Distancia de visión</span><strong>{form.viewDistance} chunks</strong></span>
          <input type="range" min={3} max={32} value={form.viewDistance} onChange={(e) => setForm({ ...form, viewDistance: Number(e.target.value) })} />
          <span className="muted small">Hasta dónde se <strong>ve</strong> el mundo. Aunque en tu juego pongas más, nadie ve más lejos que esto.</span>
        </label>
        <label className="slider">
          <span className="slider-head"><span>Distancia de simulación</span><strong>{form.simulationDistance} chunks</strong></span>
          <input type="range" min={5} max={32} value={form.simulationDistance} onChange={(e) => setForm({ ...form, simulationDistance: Number(e.target.value) })} />
          <span className="muted small">Hasta dónde el mundo <strong>funciona</strong>: mobs, cultivos, máquinas de Create. Es lo que más carga al servidor; 8–10 suele bastar.</span>
        </label>
      </div>
      {heavy && <p className="muted small">⚠ Con varios jugadores explorando, valores altos pueden causar lag (en la consola verás “Can't keep up!”). Si pasa, baja primero la simulación.</p>}
      <div className="row gap end">
        {dirty && <button className="btn ghost" onClick={() => setForm({ viewDistance: data.viewDistance, simulationDistance: data.simulationDistance })}>Descartar</button>}
        <button className="btn primary" onClick={save} disabled={!dirty || busy}>Guardar</button>
      </div>
    </details>
  );
}
