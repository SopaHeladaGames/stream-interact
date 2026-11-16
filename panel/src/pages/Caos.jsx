import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { TRIGGERS, describeTrigger } from '../rules.js';

const CHAOS_TARGETS = {
  random: { label: 'Al azar', hint: 'Cada evento le toca a alguien conectado al azar (tú incluido; nunca a los protegidos).' },
  rule: { label: 'Lo que diga cada regla', hint: 'Cada regla usa su propio “A quién le llega” (página Reglas).' },
  all: { label: 'Todos', hint: 'Cada evento le llega a todos los conectados (menos los protegidos).' }
};

// Una regla "fija" a ti: sus comandos usan {player} y ninguno {target}
const usesOnlyPlayer = (r) => {
  const cmds = (r.actions ?? []).filter((a) => a.type === 'minecraft').flatMap((a) => a.commands ?? []);
  return cmds.some((c) => c.includes('{player}')) && !cmds.some((c) => c.includes('{target}'));
};
const swapText = (v) => (typeof v === 'string' ? v.replaceAll('{player}', '{target}') : Array.isArray(v) ? v.map(swapText) : v);

const formatTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

export default function Caos() {
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState(null);
  const [rules, setRules] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () => api.caos().then((s) => {
      if (!alive) return;
      setStatus(s);
      setDraft((d) => d ?? structuredClone(s.config));
    }).catch(() => {});
    tick();
    api.reglas().then((r) => alive && setRules(r.rules.filter((x) => x.enabled !== false))).catch(() => {});
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const dirty = useMemo(() => status && draft && JSON.stringify(status.config) !== JSON.stringify(draft), [status, draft]);

  const run = (fn, okText) => async () => {
    setBusy(true);
    try {
      setStatus(await fn());
      setMsg(okText ? { type: 'ok', text: okText } : null);
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.guardarCaos(draft);
      setDraft(structuredClone(res.chaos));
      setStatus((s) => ({ ...s, config: res.chaos }));
      setMsg({ type: 'ok', text: 'Configuración guardada.' });
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  const toggleRule = (id) => setDraft((d) => ({
    ...d,
    ruleIds: d.ruleIds.includes(id) ? d.ruleIds.filter((x) => x !== id) : [...d.ruleIds, id]
  }));

  // Cambia {player} por {target} en las reglas elegidas para que el caos pueda mandárselas a otros
  const fixRules = async (ids) => {
    setBusy(true);
    try {
      const data = await api.reglas();
      const next = data.rules.map((r) => (ids.includes(r.id)
        ? { ...r, actions: r.actions.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === 'type' ? v : swapText(v)]))) }
        : r));
      const saved = await api.guardarReglas({ settings: data.settings, rules: next });
      setRules((saved.rules ?? next).filter((x) => x.enabled !== false));
      setMsg({ type: 'ok', text: `Listo: ${ids.length} regla${ids.length === 1 ? '' : 's'} ahora usa${ids.length === 1 ? '' : 'n'} {target}.` });
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  if (!status || !draft) return <h1>Modo caos</h1>;

  const orphan = draft.ruleIds.filter((id) => !rules.some((r) => r.id === id));

  return (
    <>
      <div className="section-head">
        <h1>Modo caos</h1>
        <div className="row gap">
          <button className="btn" onClick={run(api.caosAhora)} disabled={busy} title="Ejecuta una regla al azar en este momento">⚡ Lanzar uno ahora</button>
          {status.running
            ? <button className="btn danger" onClick={run(api.detenerCaos)} disabled={busy}>■ Detener</button>
            : <button className="btn primary" onClick={run(api.iniciarCaos)} disabled={busy || dirty} title={dirty ? 'Guarda los cambios primero' : ''}>▶ Activar modo caos</button>}
        </div>
      </div>
      <p className="muted">
        Cada cierto tiempo se ejecuta al azar una de las reglas que marques abajo, sin que nadie la canjee.
        Tú y tus mods pueden encenderlo o apagarlo desde el chat con <code>!caos</code>. Siempre arranca apagado al abrir la app.
      </p>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      <div className="cards">
        <div className="card status">
          <div className="row between"><span className="card-title">Estado</span><span className={`dot ${status.running ? 'warn' : 'off'}`} /></div>
          <div className="card-detail">{status.running ? (status.autoStopAt ? `Activo · se apaga a las ${new Date(status.autoStopAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Activo') : 'Apagado'}</div>
        </div>
        <div className="card status">
          <div className="row between"><span className="card-title">Próximo evento</span></div>
          <div className="card-detail chaos-countdown">{status.running && status.remainingMs != null ? formatTime(status.remainingMs) : '—'}</div>
        </div>
        <div className="card status">
          <div className="row between"><span className="card-title">Último evento</span></div>
          <div className="card-detail">
            {status.last ? `${status.last.label}${status.last.target ? ` → ${status.last.target}` : ''} · ${new Date(status.last.at).toLocaleTimeString('es-MX', { hour12: false })}` : '—'}
          </div>
        </div>
      </div>
      {status.lastSkip && status.running && (
        <div className="banner warn">El último turno no se ejecutó: {status.lastSkip.reason}.</div>
      )}

      <div className="card">
        <div className="row between">
          <h3>Configuración</h3>
          <div className="row gap">
            {dirty && <span className="unsaved">● Cambios sin guardar</span>}
            <button className="btn primary small" onClick={save} disabled={!dirty || busy}>Guardar</button>
          </div>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Intervalo mínimo (s)</span>
            <input type="number" min="15" max="3600" value={draft.minSeconds} onChange={(e) => setDraft({ ...draft, minSeconds: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Intervalo máximo (s)</span>
            <input type="number" min="15" max="3600" value={draft.maxSeconds} onChange={(e) => setDraft({ ...draft, maxSeconds: Number(e.target.value) })} />
          </label>
          <div className="field grow">
            <span>&nbsp;</span>
            <div className="muted small chaos-hint">Cada evento ocurre en un momento al azar entre {formatTime(draft.minSeconds * 1000)} y {formatTime(draft.maxSeconds * 1000)} después del anterior.</div>
          </div>
        </div>

        <h3>A quién le toca</h3>
        <div className="segmented wide">
          {Object.entries(CHAOS_TARGETS).map(([id, info]) => (
            <button key={id} className={(draft.target ?? 'random') === id ? 'active' : ''} onClick={() => setDraft({ ...draft, target: id })}>{info.label}</button>
          ))}
        </div>
        <p className="muted small target-hint">{CHAOS_TARGETS[draft.target ?? 'random'].hint}</p>
        {(() => {
          const fixed = rules.filter((r) => draft.ruleIds.includes(r.id) && usesOnlyPlayer(r));
          if ((draft.target ?? 'random') === 'rule' || fixed.length === 0) return null;
          return (
            <div className="banner warn target-warn">
              <span>
                {fixed.length === 1 ? 'Esta regla usa' : `Estas ${fixed.length} reglas usan`} <code>{'{player}'}</code> en sus comandos, así que siempre te llega{fixed.length === 1 ? '' : 'n'} a ti:{' '}
                <strong>{fixed.map((r) => describeTrigger(r.trigger)).join(', ')}</strong>. Para que el caos pueda mandárselas a otros deben usar <code>{'{target}'}</code>.
              </span>
              <button className="btn small" disabled={busy} onClick={() => fixRules(fixed.map((r) => r.id))}>Cambiar {'{player}'} por {'{target}'}</button>
            </div>
          );
        })()}

        <div className="row between mt">
          <h3>Reglas que pueden salir ({draft.ruleIds.length - orphan.length})</h3>
          <div className="row gap">
            <button className="btn small ghost" onClick={() => setDraft({ ...draft, ruleIds: rules.map((r) => r.id) })}>Todas</button>
            <button className="btn small ghost" onClick={() => setDraft({ ...draft, ruleIds: [] })}>Ninguna</button>
          </div>
        </div>
        <div className="chaos-rules">
          {rules.map((r) => (
            <label key={r.id} className={`chaos-rule ${draft.ruleIds.includes(r.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={draft.ruleIds.includes(r.id)} onChange={() => toggleRule(r.id)} />
              <span className={`badge b-${r.trigger?.type}`}>{TRIGGERS[r.trigger?.type]?.label}</span>
              <span className="rule-name">{describeTrigger(r.trigger)}</span>
              {(draft.target ?? 'random') !== 'rule' && usesOnlyPlayer(r) && <span className="target-tag warn-tag" title="Usa {player}: siempre te llega a ti">solo a ti</span>}
            </label>
          ))}
          {rules.length === 0 && <div className="empty">No hay reglas activas.</div>}
        </div>
        {orphan.length > 0 && (
          <p className="muted small">
            {orphan.length} regla{orphan.length === 1 ? '' : 's'} de la lista ya no existe{orphan.length === 1 ? '' : 'n'} o está{orphan.length === 1 ? '' : 'n'} desactivada{orphan.length === 1 ? '' : 's'} ({orphan.join(', ')}); se ignoran.{' '}
            <button className="btn small ghost" onClick={() => setDraft({ ...draft, ruleIds: draft.ruleIds.filter((id) => !orphan.includes(id)) })}>Quitar</button>
          </p>
        )}
      </div>
    </>
  );
}
