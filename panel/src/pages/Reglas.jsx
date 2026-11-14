import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import RuleEditor from '../components/RuleEditor.jsx';
import JugadoresChat from '../components/JugadoresChat.jsx';
import { TARGETS, TRIGGERS, describeTrigger, newRule, simulatedEventFor } from '../rules.js';

export default function Reglas() {
  const [saved, setSaved] = useState(null);   // lo que hay en disco
  const [draft, setDraft] = useState(null);   // lo que estás editando
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState(null); // { type: 'ok'|'error', text }
  const [saving, setSaving] = useState(false);

  const load = () => api.reglas()
    .then((d) => { setSaved(d); setDraft(structuredClone({ settings: d.settings, rules: d.rules })); })
    .catch((e) => setStatus({ type: 'error', text: e.message }));
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => saved && draft &&
    JSON.stringify({ settings: saved.settings, rules: saved.rules }) !== JSON.stringify(draft), [saved, draft]);

  // Avisar si cierras la pestaña con cambios sin guardar
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (!draft) return <><h1>Reglas</h1>{status && <div className={`banner ${status.type}`}>{status.text}</div>}</>;

  const rules = draft.rules;
  const rule = rules[selected];

  const setRules = (fn) => setDraft((d) => ({ ...d, rules: fn(d.rules) }));
  const updateRule = (next) => setRules((rs) => rs.map((r, i) => (i === selected ? next : r)));
  const setSetting = (key, value) => setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));

  const add = () => {
    setRules((rs) => [...rs, newRule(rs.map((r) => r.id))]);
    setSelected(rules.length);
  };
  const duplicate = () => {
    const copy = structuredClone(rule);
    let id = `${rule.id}-copia`; let n = 2;
    while (rules.some((r) => r.id === id)) id = `${rule.id}-copia-${n++}`;
    copy.id = id;
    setRules((rs) => [...rs.slice(0, selected + 1), copy, ...rs.slice(selected + 1)]);
    setSelected(selected + 1);
  };
  const remove = () => {
    if (!confirm(`¿Eliminar la regla "${rule.id}"?`)) return;
    setRules((rs) => rs.filter((_, i) => i !== selected));
    setSelected(Math.max(0, selected - 1));
  };
  const move = (dir) => {
    const to = selected + dir;
    if (to < 0 || to >= rules.length) return;
    setRules((rs) => { const c = [...rs]; [c[selected], c[to]] = [c[to], c[selected]]; return c; });
    setSelected(to);
  };
  const toggle = (i) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, enabled: r.enabled === false } : r)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.guardarReglas(draft);
      setSaved({ ...saved, ...res });
      setDraft(structuredClone(res));
      setStatus({ type: 'ok', text: 'Reglas guardadas y aplicadas.' });
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => { setDraft(structuredClone({ settings: saved.settings, rules: saved.rules })); setStatus(null); };

  const test = async () => {
    if (dirty) setStatus({ type: 'warn', text: 'La prueba usa la versión guardada de las reglas. Guarda primero para probar tus cambios.' });
    await api.simular(simulatedEventFor(rule)).catch((e) => setStatus({ type: 'error', text: e.message }));
  };

  return (
    <>
      <div className="section-head">
        <h1>Reglas</h1>
        <div className="row gap">
          {dirty && <span className="unsaved">● Cambios sin guardar</span>}
          <button className="btn ghost" onClick={discard} disabled={!dirty || saving}>Descartar</button>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
      {status && <div className={`banner ${status.type}`} onClick={() => setStatus(null)}>{status.text}</div>}

      <div className="rules-layout">
        <div className="rule-list">
          <div className="row between list-head">
            <span className="muted small">Se usa la primera regla que coincida</span>
            <button className="btn small" onClick={add}>+ Nueva</button>
          </div>
          {rules.map((r, i) => (
            <div key={i} className={`rule-item ${i === selected ? 'active' : ''} ${r.enabled === false ? 'disabled' : ''}`} onClick={() => setSelected(i)}>
              <div className="rule-item-main">
                <span className={`badge b-${r.trigger?.type}`}>{TRIGGERS[r.trigger?.type]?.label ?? '?'}</span>
                <span className="rule-name">{describeTrigger(r.trigger)}</span>
                {r.target && r.target !== 'me' && <span className="target-tag" title={`Objetivo: ${TARGETS[r.target]?.label}`}>🎯</span>}
              </div>
              <label className="switch" onClick={(e) => e.stopPropagation()} title={r.enabled === false ? 'Desactivada' : 'Activa'}>
                <input type="checkbox" checked={r.enabled !== false} onChange={() => toggle(i)} />
                <span />
              </label>
            </div>
          ))}
          {rules.length === 0 && <div className="empty">No hay reglas. Crea una con “+ Nueva”.</div>}
        </div>

        <div className="rule-detail">
          {rule ? (
            <>
              <div className="row gap toolbar">
                <button className="btn small" onClick={() => move(-1)} disabled={selected === 0} title="Subir prioridad">↑</button>
                <button className="btn small" onClick={() => move(1)} disabled={selected === rules.length - 1} title="Bajar prioridad">↓</button>
                <button className="btn small" onClick={duplicate}>Duplicar</button>
                <button className="btn small" onClick={test}>▶ Probar</button>
                <span className="spacer" />
                <button className="btn small danger" onClick={remove}>Eliminar</button>
              </div>
              <RuleEditor rule={rule} onChange={updateRule} />
            </>
          ) : <div className="empty">Selecciona una regla.</div>}
        </div>
      </div>

      <h2>Ajustes</h2>
      <div className="card settings">
        <label className="check">
          <input type="checkbox" checked={draft.settings.cooldownReplies !== false} onChange={(e) => setSetting('cooldownReplies', e.target.checked)} />
          Avisar en el chat cuando algo está en cooldown
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.settings.pauseRewards !== false} onChange={(e) => setSetting('pauseRewards', e.target.checked)} />
          Al pausar todo, pausar también en Twitch las recompensas creadas por la app (se reanudan al quitar la pausa)
        </label>
        <div className="field-row">
          <label className="field">
            <span>Comando de ayuda</span>
            <input value={draft.settings.helpCommand ?? '!comandos'} onChange={(e) => setSetting('helpCommand', e.target.value)} />
          </label>
          <label className="field">
            <span>Cooldown del comando de ayuda (s)</span>
            <input type="number" min="0" value={(draft.settings.helpCooldownMs ?? 30000) / 1000}
              onChange={(e) => setSetting('helpCooldownMs', Math.max(0, Number(e.target.value)) * 1000)} />
          </label>
                </div>
      </div>

      <h2>Jugadores y el chat</h2>
      <JugadoresChat />
    </>
  );
}
