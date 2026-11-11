import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Recompensas({ conectado }) {
  const [rewards, setRewards] = useState(null);
  const [ruleNames, setRuleNames] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ title: '', cost: 500, prompt: '', userInputRequired: false, globalCooldown: '' });
  const [creating, setCreating] = useState(false);

  const load = () => {
    setError(null);
    api.recompensas().then(setRewards).catch((e) => setError(e.message));
    api.reglas().then((d) => setRuleNames(d.rules
      .filter((r) => r.trigger?.type === 'reward' && r.enabled !== false)
      .map((r) => r.trigger.name.toLowerCase()))).catch(() => {});
  };
  useEffect(() => { if (conectado) load(); }, [conectado]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.crearRecompensa({ ...form, cost: Number(form.cost), globalCooldown: form.globalCooldown ? Number(form.globalCooldown) : undefined });
      setForm({ title: '', cost: 500, prompt: '', userInputRequired: false, globalCooldown: '' });
      load();
    } catch (err) { setError(err.message); } finally { setCreating(false); }
  };

  if (!conectado) {
    return <><h1>Recompensas</h1><div className="banner warn">Conecta tu cuenta de Twitch para ver tus recompensas.</div></>;
  }

  return (
    <>
      <div className="section-head">
        <h1>Recompensas de Twitch</h1>
        <button className="btn ghost" onClick={load}>Actualizar</button>
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Recompensa</th><th>Costo</th><th>Estado</th><th>Regla</th><th>Reembolso automático</th></tr>
          </thead>
          <tbody>
            {rewards === null && <tr><td colSpan={5} className="muted">Cargando…</td></tr>}
            {rewards?.length === 0 && <tr><td colSpan={5} className="muted">Tu canal no tiene recompensas personalizadas.</td></tr>}
            {rewards?.map((r) => {
              const hasRule = ruleNames.includes(r.title.toLowerCase());
              return (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong>{r.prompt && <div className="muted small">{r.prompt}</div>}</td>
                  <td>{r.cost.toLocaleString('es-MX')}</td>
                  <td>{!r.enabled ? <span className="pill off">Desactivada</span> : r.paused ? <span className="pill warn">Pausada</span> : <span className="pill ok">Activa</span>}</td>
                  <td>{hasRule ? <span className="pill ok">Sí</span> : <span className="pill off" title="Crea una regla de tipo Recompensa con este título">Sin regla</span>}</td>
                  <td>{r.managedByApp ? <span className="pill ok">Sí</span> : <span className="muted small" title="Twitch solo permite reembolsar recompensas creadas por esta app">No (creada en Twitch)</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Crear recompensa desde la app</h3>
        <p className="muted small">Las recompensas creadas aquí permiten que la app devuelva los puntos cuando una regla está en cooldown.</p>
        <form onSubmit={create}>
          <div className="field-row">
            <label className="field grow">
              <span>Título</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={45} />
            </label>
            <label className="field">
              <span>Costo (puntos)</span>
              <input type="number" min="1" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required />
            </label>
            <label className="field">
              <span>Cooldown en Twitch (s, opcional)</span>
              <input type="number" min="1" value={form.globalCooldown} onChange={(e) => setForm({ ...form, globalCooldown: e.target.value })} />
            </label>
          </div>
          <div className="field-row">
            <label className="field grow">
              <span>Descripción (opcional)</span>
              <input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} maxLength={200} />
            </label>
            <label className="check align-end">
              <input type="checkbox" checked={form.userInputRequired} onChange={(e) => setForm({ ...form, userInputRequired: e.target.checked })} />
              Pedir texto al espectador
            </label>
            <button className="btn primary align-end" disabled={creating}>{creating ? 'Creando…' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
