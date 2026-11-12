import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PollWidget from '../components/PollWidget.jsx';
import { TRIGGERS, describeTrigger } from '../rules.js';

const newPoll = () => ({
  id: `votacion-${Date.now().toString(36)}`,
  question: '',
  duration: 30,
  onNoVotes: 'nothing',
  options: [{ label: '', ruleId: '' }, { label: '', ruleId: '' }]
});

export default function Votaciones() {
  const [saved, setSaved] = useState(null);
  const [polls, setPolls] = useState(null);
  const [rules, setRules] = useState([]);
  const [msg, setMsg] = useState(null); // { type, text }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.juego(), api.reglas()])
      .then(([game, r]) => {
        setSaved(game.polls);
        setPolls(structuredClone(game.polls));
        setRules(r.rules.filter((x) => x.enabled !== false));
      })
      .catch((e) => setMsg({ type: 'error', text: e.message }));
  }, []);

  const dirty = useMemo(() => saved && polls && JSON.stringify(saved) !== JSON.stringify(polls), [saved, polls]);
  const error = (text) => setMsg({ type: 'error', text });

  const update = (i, patch) => setPolls((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const updateOption = (i, k, patch) => update(i, { options: polls[i].options.map((o, j) => (j === k ? { ...o, ...patch } : o)) });

  // Al elegir una regla, se propone su nombre como etiqueta (si no escribiste una propia)
  const chooseRule = (i, k, ruleId) => {
    const option = polls[i].options[k];
    const previous = rules.find((r) => r.id === option.ruleId);
    const next = rules.find((r) => r.id === ruleId);
    const untouched = !option.label || (previous && option.label === describeTrigger(previous.trigger));
    updateOption(i, k, { ruleId, ...(untouched && next ? { label: describeTrigger(next.trigger) } : {}) });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.guardarVotaciones(polls);
      setSaved(res.polls);
      setPolls(structuredClone(res.polls));
      setMsg({ type: 'ok', text: 'Votaciones guardadas.' });
    } catch (e) { error(e.message); } finally { setSaving(false); }
  };

  const start = async (poll) => {
    try {
      await api.iniciarVotacion(poll);
      setMsg(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { error(e.message); }
  };

  if (!polls) return <><h1>Votaciones</h1>{msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}</>;

  return (
    <>
      <div className="section-head">
        <h1>Votaciones</h1>
        <div className="row gap">
          {dirty && <span className="unsaved">● Cambios sin guardar</span>}
          <button className="btn" onClick={() => setPolls((ps) => [...ps, newPoll()])}>+ Nueva votación</button>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
      <p className="muted">
        El chat vota escribiendo el número de la opción (<code>1</code>, <code>2</code>…). La opción ganadora ejecuta la regla que elijas.
        Tú y tus mods también pueden lanzarlas desde el chat con <code>!votacion</code> o <code>!votacion nombre</code>, y cancelarlas con <code>!votacion cancelar</code>.
      </p>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      <PollWidget live controls onError={error} />

      {polls.length === 0 && <div className="card empty">No hay votaciones. Crea una con “+ Nueva votación”.</div>}

      {polls.map((poll, i) => (
        <div key={poll.id} className="card poll-card">
          <div className="field-row">
            <label className="field grow">
              <span>Pregunta</span>
              <input value={poll.question} onChange={(e) => update(i, { question: e.target.value })} placeholder="¿Zombie o creeper?" maxLength={120} />
            </label>
            <label className="field narrow">
              <span>Duración (s)</span>
              <input type="number" min="10" max="600" value={poll.duration} onChange={(e) => update(i, { duration: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Si nadie vota</span>
              <select value={poll.onNoVotes} onChange={(e) => update(i, { onNoVotes: e.target.value })}>
                <option value="nothing">No pasa nada</option>
                <option value="random">Gana una opción al azar</option>
              </select>
            </label>
          </div>

          {poll.options.map((o, k) => {
            const missing = o.ruleId && !rules.some((r) => r.id === o.ruleId);
            return (
              <div key={k} className="poll-edit-option">
                <span className="poll-num">{k + 1}</span>
                <select value={o.ruleId} onChange={(e) => chooseRule(i, k, e.target.value)} className={missing ? 'invalid' : ''}>
                  <option value="">— Elige qué pasa si gana —</option>
                  {missing && <option value={o.ruleId}>(regla no encontrada: {o.ruleId})</option>}
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>{TRIGGERS[r.trigger?.type]?.label}: {describeTrigger(r.trigger)}</option>
                  ))}
                </select>
                <input value={o.label} onChange={(e) => updateOption(i, k, { label: e.target.value })} placeholder="Nombre que verá el chat" maxLength={40} />
                <button className="icon-btn danger" disabled={poll.options.length <= 2} onClick={() => update(i, { options: poll.options.filter((_, j) => j !== k) })} title="Quitar opción">✕</button>
              </div>
            );
          })}

          <div className="row gap between poll-card-foot">
            <button className="btn small ghost" disabled={poll.options.length >= 5} onClick={() => update(i, { options: [...poll.options, { label: '', ruleId: '' }] })}>+ Opción</button>
            <div className="row gap">
              <button className="btn small ghost danger" onClick={() => confirm(`¿Eliminar la votación "${poll.question || 'sin título'}"?`) && setPolls((ps) => ps.filter((_, j) => j !== i))}>Eliminar</button>
              <button className="btn primary" onClick={() => start(poll)}>▶ Iniciar votación</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
