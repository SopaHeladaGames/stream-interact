import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const EMPTY_FORM = { title: '', cost: 500, prompt: '', userInputRequired: false, globalCooldown: '', backgroundColor: '#9146FF' };

export default function Recompensas({ conectado }) {
  const [rewards, setRewards] = useState(null);
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // id de la recompensa en edición
  const [busyId, setBusyId] = useState(null);
  const [onlyApp, setOnlyApp] = useState(false);
  const [profiles, setProfiles] = useState({ active: null, profiles: [], rewards: {} });
  const [newProfile, setNewProfile] = useState('');
  const formRef = useRef(null);

  const load = async () => {
    setError(null);
    try {
      const [rw, rl, pf] = await Promise.all([api.recompensas(), api.reglas(), api.perfiles()]);
      setRewards(rw);
      setRules(rl);
      setProfiles(pf);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (conectado) load(); }, [conectado]);

  const ruleFor = (title) => rules?.rules.find((r) => r.trigger?.type === 'reward' && r.trigger.name?.toLowerCase() === title.toLowerCase());

  // Cambia una recompensa y actualiza la fila sin recargar toda la lista
  const patch = async (reward, changes) => {
    setBusyId(reward.id); setError(null);
    const before = rewards;
    setRewards((rs) => rs.map((r) => (r.id === reward.id ? { ...r, ...toRow(changes) } : r)));
    try {
      await api.actualizarRecompensa(reward.id, changes);
    } catch (e) {
      setRewards(before);
      setError(e.message);
    } finally { setBusyId(null); }
  };

  const remove = async (reward) => {
    const rule = ruleFor(reward.title);
    const msg = `¿Eliminar "${reward.title}" de tu canal de Twitch?${rule ? `\n\nLa regla "${rule.id}" se quedará sin recompensa (no se borra).` : ''}\n\nEsto no se puede deshacer.`;
    if (!confirm(msg)) return;
    setBusyId(reward.id); setError(null);
    try {
      await api.eliminarRecompensa(reward.id);
      setRewards((rs) => rs.filter((r) => r.id !== reward.id));
      setNotice(`"${reward.title}" eliminada.`);
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

  const saveEdit = async (reward, values, updateRule) => {
    setBusyId(reward.id); setError(null);
    try {
      await api.actualizarRecompensa(reward.id, values);
      const renamed = values.title && values.title !== reward.title;
      const rule = renamed && updateRule ? ruleFor(reward.title) : null;
      if (rule) {
        const next = rules.rules.map((r) => (r === rule ? { ...r, trigger: { ...r.trigger, name: values.title } } : r));
        await api.guardarReglas({ settings: rules.settings, rules: next });
      }
      setNotice(`"${values.title ?? reward.title}" actualizada${rule ? ` y la regla "${rule.id}" también` : ''}.`);
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

  const create = async (e) => {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      await api.crearRecompensa({ ...form, cost: Number(form.cost), globalCooldown: form.globalCooldown ? Number(form.globalCooldown) : undefined });
      setNotice(`"${form.title}" creada. Ya la puedes administrar desde aquí.`);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) { setError(err.message); } finally { setCreating(false); }
  };

  // Copia los datos de una recompensa creada en Twitch al formulario, para recrearla desde la app
  const recreate = (r) => {
    setForm({
      title: r.title, cost: r.cost, prompt: r.prompt ?? '', userInputRequired: r.userInputRequired,
      globalCooldown: r.globalCooldown ?? '', backgroundColor: r.backgroundColor || EMPTY_FORM.backgroundColor
    });
    setNotice(`Datos de "${r.title}" copiados al formulario. Primero elimínala en el panel de Twitch (los títulos deben ser únicos) y luego presiona Crear.`);
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ---- Perfiles de juego ----
  const profileName = (id) => profiles.profiles.find((p) => p.id === id)?.name;
  const addProfile = async (e) => {
    e.preventDefault();
    try { setProfiles(await api.crearPerfil(newProfile)); setNewProfile(''); } catch (err) { setError(err.message); }
  };
  const renameProfile = async (p) => {
    const name = prompt('Nuevo nombre del perfil', p.name);
    if (!name || name === p.name) return;
    try { setProfiles(await api.renombrarPerfil(p.id, name)); } catch (err) { setError(err.message); }
  };
  const deleteProfile = async (p) => {
    if (!confirm(`¿Borrar el perfil "${p.name}"?\n\nSus recompensas quedan sin perfil (no se borran de Twitch) y sus reglas pasan a funcionar siempre.`)) return;
    try { setProfiles(await api.borrarPerfil(p.id)); await load(); } catch (err) { setError(err.message); }
  };
  const activateProfile = async (id) => {
    setError(null);
    try {
      const r = await api.activarPerfil(id);
      const name = profileName(id) ?? 'ninguno';
      setNotice(`Perfil activo: ${name}.${r.enabled || r.disabled ? ` ${r.enabled} recompensas encendidas y ${r.disabled} apagadas.` : ''}${r.failed?.length ? ` No se pudieron cambiar: ${r.failed.map((f) => f.title).join(', ')}.` : ''}`);
      await load();
    } catch (err) { setError(err.message); }
  };
  const assignProfile = async (reward, profileId) => {
    setBusyId(reward.id); setError(null);
    try {
      const r = await api.asignarPerfil(reward.id, profileId || null);
      setProfiles(r);
      if (r.enabled !== null && r.enabled !== undefined) setRewards((rs) => rs.map((x) => (x.id === reward.id ? { ...x, enabled: r.enabled } : x)));
    } catch (err) { setError(err.message); } finally { setBusyId(null); }
  };

  if (!conectado) {
    return <><h1>Recompensas</h1><div className="banner warn">Conecta tu cuenta de Twitch para ver tus recompensas.</div></>;
  }

  const appCount = rewards?.filter((r) => r.managedByApp).length ?? 0;
  const visible = rewards?.filter((r) => !onlyApp || r.managedByApp);

  return (
    <>
      <div className="section-head">
        <h1>Recompensas de Twitch</h1>
        <div className="row gap">
          <label className="check"><input type="checkbox" checked={onlyApp} onChange={(e) => setOnlyApp(e.target.checked)} /> Solo las de la app</label>
          <button className="btn ghost" onClick={load}>Actualizar</button>
        </div>
      </div>
      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {notice && <div className="banner ok" onClick={() => setNotice(null)}>{notice}</div>}
      {rewards && rewards.length > appCount && (
        <p className="muted small">
          🔒 = creada en el panel de Twitch. Twitch no deja que otras apps la modifiquen. Usa <strong>Recrear en la app</strong> para pasarla aquí.
        </p>
      )}

      <div className="card profiles-card">
        <div className="row between wrap gap">
          <h3 className="no-margin">Perfiles de juego</h3>
          <form className="row gap" onSubmit={addProfile}>
            <input value={newProfile} maxLength={30} placeholder="Minecraft, Terraria…" onChange={(e) => setNewProfile(e.target.value)} />
            <button className="btn small" disabled={!newProfile.trim()}>+ Perfil</button>
          </form>
        </div>
        <p className="muted small">
          Asigna recompensas (columna <strong>Perfil</strong>) y reglas (en el editor de reglas) a un perfil. Al activar un perfil se encienden
          sus recompensas y reglas y se apagan las de los demás. Lo que no tiene perfil funciona siempre. También lo puedes cambiar desde la barra lateral.
        </p>
        <div className="chips">
          <button className={`profile-chip ${!profiles.active ? 'active' : ''}`} onClick={() => activateProfile(null)} title="Apaga las recompensas y reglas de todos los perfiles">Ninguno</button>
          {profiles.profiles.map((p) => (
            <span key={p.id} className={`profile-chip ${profiles.active === p.id ? 'active' : ''}`}>
              <button style={{ opacity: 1, fontWeight: 600 }} onClick={() => activateProfile(p.id)} title="Activar este perfil">{profiles.active === p.id ? '● ' : '○ '}{p.name}</button>
              <span className="muted small">{p.rewards} rec.</span>
              <button onClick={() => renameProfile(p)} title="Cambiar nombre">✎</button>
              <button onClick={() => deleteProfile(p)} title="Borrar perfil">✕</button>
            </span>
          ))}
        </div>
      </div>

      <div className="card flush">
        <table className="table rewards">
          <thead>
            <tr><th>Recompensa</th><th>Costo</th><th>Activa</th><th>Canjes</th><th>Perfil</th><th>Regla</th><th /></tr>
          </thead>
          <tbody>
            {rewards === null && <tr><td colSpan={7} className="muted">Cargando…</td></tr>}
            {visible?.length === 0 && <tr><td colSpan={7} className="muted">No hay recompensas que mostrar.</td></tr>}
            {visible?.map((r) => {
              const rule = ruleFor(r.title);
              const busy = busyId === r.id;
              const locked = !r.managedByApp;
              return [
                <tr key={r.id} className={`${!r.enabled ? 'row-off' : ''} ${editing === r.id ? 'row-editing' : ''}`}>
                  <td>
                    <div className="reward-title">
                      <span className="reward-color" style={{ background: r.backgroundColor || '#555' }} />
                      <strong>{r.title}</strong>
                      {locked && <span title="Creada en el panel de Twitch: solo lectura">🔒</span>}
                    </div>
                    {r.prompt && <div className="muted small reward-prompt">{r.prompt}</div>}
                  </td>
                  <td className="nowrap">{r.cost.toLocaleString('es-MX')}</td>
                  <td>
                    <label className={`switch ${locked ? 'locked' : ''}`} title={locked ? 'Solo se puede cambiar en Twitch' : r.enabled ? 'Desactivar (desaparece del canal)' : 'Activar'}>
                      <input type="checkbox" checked={r.enabled} disabled={locked || busy} onChange={() => patch(r, { isEnabled: !r.enabled })} />
                      <span />
                    </label>
                  </td>
                  <td>
                    {locked ? (
                      r.paused ? <span className="pill warn">Pausados</span> : <span className="pill off">Abiertos</span>
                    ) : (
                      <button
                        className={`btn small ${r.paused ? 'warn' : 'ghost'}`}
                        disabled={busy || !r.enabled}
                        onClick={() => patch(r, { isPaused: !r.paused })}
                        title={r.paused ? 'Los espectadores la ven pero no la pueden canjear' : 'Pausar canjes sin ocultarla'}
                      >
                        {r.paused ? '▶ Reanudar' : '⏸ Pausar'}
                      </button>
                    )}
                  </td>
                  <td>
                    {locked ? <span className="muted small" title="Twitch no deja que la app la encienda o apague">—</span> : (
                      <select value={profiles.rewards[r.id] ?? ''} disabled={busy || profiles.profiles.length === 0} onChange={(e) => assignProfile(r, e.target.value)}
                        title={profiles.profiles.length === 0 ? 'Crea un perfil arriba' : 'Se enciende solo cuando este perfil está activo'}>
                        <option value="">Siempre</option>
                        {profiles.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{rule ? <span className="pill ok" title={`Regla "${rule.id}"`}>{rule.enabled === false ? 'Sí (desactivada)' : 'Sí'}</span> : <span className="pill off" title="Crea una regla de tipo Recompensa con este título">Sin regla</span>}</td>
                  <td className="nowrap actions-cell">
                    {locked ? (
                      <button className="btn small ghost" onClick={() => recreate(r)}>Recrear en la app</button>
                    ) : (
                      <>
                        <button className="btn small ghost" disabled={busy} onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? 'Cerrar' : 'Editar'}</button>
                        <button className="btn small ghost danger" disabled={busy} onClick={() => remove(r)}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>,
                editing === r.id && (
                  <tr key={`${r.id}-edit`} className="edit-row">
                    <td colSpan={7}>
                      <EditReward reward={r} hasRule={Boolean(rule)} busy={busy} onCancel={() => setEditing(null)} onSave={(v, upd) => saveEdit(r, v, upd)} />
                    </td>
                  </tr>
                )
              ];
            })}
          </tbody>
        </table>
      </div>

      <div className="card" ref={formRef}>
        <h3>Crear recompensa desde la app</h3>
        <p className="muted small">Las recompensas creadas aquí se pueden activar, pausar, editar y eliminar desde la app, y la app devuelve los puntos cuando una regla está en cooldown.</p>
        <form onSubmit={create}>
          <RewardFields values={form} onChange={setForm} />
          <div className="row gap end">
            {form !== EMPTY_FORM && <button type="button" className="btn ghost" onClick={() => setForm(EMPTY_FORM)}>Limpiar</button>}
            <button className="btn primary" disabled={creating}>{creating ? 'Creando…' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

/** Formulario de edición en línea. */
function EditReward({ reward, hasRule, busy, onSave, onCancel }) {
  const [values, setValues] = useState({
    title: reward.title, cost: reward.cost, prompt: reward.prompt ?? '', userInputRequired: reward.userInputRequired,
    globalCooldown: reward.globalCooldown ?? '', backgroundColor: reward.backgroundColor || '#9146FF'
  });
  const [updateRule, setUpdateRule] = useState(true);
  const renamed = values.title.trim() !== reward.title;

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...values,
      title: values.title.trim(),
      cost: Number(values.cost),
      globalCooldown: values.globalCooldown ? Number(values.globalCooldown) : null
    }, updateRule);
  };

  return (
    <form className="edit-form" onSubmit={submit}>
      <RewardFields values={values} onChange={setValues} />
      <div className="row gap between">
        <div>
          {renamed && hasRule && (
            <label className="check">
              <input type="checkbox" checked={updateRule} onChange={(e) => setUpdateRule(e.target.checked)} />
              Cambiar también el nombre en la regla (si no, la regla dejará de coincidir)
            </label>
          )}
        </div>
        <div className="row gap">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </div>
    </form>
  );
}

/** Campos compartidos entre crear y editar. */
function RewardFields({ values, onChange }) {
  const set = (patch) => onChange({ ...values, ...patch });
  return (
    <>
      <div className="field-row">
        <label className="field grow">
          <span>Título</span>
          <input value={values.title} onChange={(e) => set({ title: e.target.value })} required maxLength={45} />
        </label>
        <label className="field">
          <span>Costo (puntos)</span>
          <input type="number" min="1" value={values.cost} onChange={(e) => set({ cost: e.target.value })} required />
        </label>
        <label className="field">
          <span>Cooldown en Twitch (s, opcional)</span>
          <input type="number" min="1" value={values.globalCooldown} onChange={(e) => set({ globalCooldown: e.target.value })} />
        </label>
        <label className="field">
          <span>Color</span>
          <input type="color" className="color-input" value={values.backgroundColor} onChange={(e) => set({ backgroundColor: e.target.value.toUpperCase() })} />
        </label>
      </div>
      <div className="field-row">
        <label className="field grow">
          <span>Descripción (opcional)</span>
          <input value={values.prompt} onChange={(e) => set({ prompt: e.target.value })} maxLength={200} />
        </label>
        <label className="check align-end">
          <input type="checkbox" checked={values.userInputRequired} onChange={(e) => set({ userInputRequired: e.target.checked })} />
          Pedir texto al espectador
        </label>
      </div>
    </>
  );
}

/** Traduce los nombres de la API de Twitch a los de la tabla. */
function toRow(changes) {
  const row = { ...changes };
  if ('isEnabled' in changes) row.enabled = changes.isEnabled;
  if ('isPaused' in changes) row.paused = changes.isPaused;
  return row;
}
