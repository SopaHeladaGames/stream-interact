import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { TRIGGERS, describeTrigger, simulatedEventFor } from '../rules.js';

export default function Probar() {
  const [rules, setRules] = useState([]);
  const [user, setUser] = useState('Tester');
  const [custom, setCustom] = useState({ type: 'command', name: '!zombie', amount: 100, input: '' });
  const [command, setCommand] = useState('');
  const [mcResult, setMcResult] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => { api.reglas().then((d) => setRules(d.rules.filter((r) => r.enabled !== false))).catch(() => {}); }, []);

  const notify = (text, type = 'ok') => { setFlash({ text, type }); setTimeout(() => setFlash(null), 2500); };

  const fire = async (event) => {
    try {
      await api.simular({ ...event, user: user || 'Tester' });
      notify(`Enviado: ${event.type} ${event.name === 'bits' ? `${event.amount} bits` : event.name}`);
    } catch (e) { notify(e.message, 'error'); }
  };

  const runCommand = async (e) => {
    e.preventDefault();
    try {
      const { response } = await api.comandoMinecraft(command);
      setMcResult({ ok: true, text: response || '(sin respuesta)' });
    } catch (err) { setMcResult({ ok: false, text: err.message }); }
  };

  return (
    <>
      <h1>Probar</h1>
      <p className="muted">Simula eventos sin estar en directo. Revisa el resultado en Inicio → Actividad en vivo, o dentro del juego.
        Las pruebas no respetan ni activan los tiempos de espera, no cuentan para el límite por directo y sus mensajes no se mandan a tu chat de Twitch.</p>
      {flash && <div className={`banner ${flash.type}`}>{flash.text}</div>}

      <div className="card">
        <div className="row between">
          <h3>Tus reglas</h3>
          <label className="field inline">
            <span>Usuario simulado</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
        </div>
        <div className="test-grid">
          {rules.map((r) => (
            <button key={r.id} className="test-btn" onClick={() => fire(simulatedEventFor(r))}>
              <span className={`badge b-${r.trigger.type}`}>{TRIGGERS[r.trigger.type]?.label}</span>
              <span>{describeTrigger(r.trigger)}</span>
            </button>
          ))}
          {rules.length === 0 && <div className="empty">No hay reglas activas.</div>}
        </div>
      </div>

      <div className="card">
        <h3>Evento personalizado</h3>
        <div className="field-row">
          <label className="field">
            <span>Tipo</span>
            <select value={custom.type} onChange={(e) => setCustom({ ...custom, type: e.target.value })}>
              {Object.entries(TRIGGERS).map(([t, info]) => <option key={t} value={t}>{info.label}</option>)}
            </select>
          </label>
          {custom.type === 'cheer' || custom.type === 'donation' ? (
            <>
              <label className="field">
                <span>{custom.type === 'cheer' ? 'Bits' : 'Monto'}</span>
                <input type="number" min="1" value={custom.amount} onChange={(e) => setCustom({ ...custom, amount: Number(e.target.value) })} />
              </label>
              {custom.type === 'donation' && (
                <label className="field narrow">
                  <span>Moneda</span>
                  <input value={custom.currency ?? 'MXN'} maxLength={3} onChange={(e) => setCustom({ ...custom, currency: e.target.value.toUpperCase() })} />
                </label>
              )}
            </>
          ) : (
            <label className="field grow">
              <span>{custom.type === 'command' ? 'Comando' : 'Título de la recompensa'}</span>
              <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            </label>
          )}
          <label className="field grow">
            <span>Texto del usuario (opcional)</span>
            <input value={custom.input} onChange={(e) => setCustom({ ...custom, input: e.target.value })} />
          </label>
          <button className="btn primary align-end" onClick={() => fire(
            custom.type === 'cheer' ? { type: 'cheer', name: 'bits', amount: custom.amount, input: custom.input }
              : custom.type === 'donation' ? { type: 'donation', name: 'donation', amount: custom.amount, currency: custom.currency ?? 'MXN', input: custom.input }
                : { type: custom.type, name: custom.name, input: custom.input })}>Enviar</button>
        </div>
      </div>

      <div className="card">
        <h3>Comando directo a Minecraft</h3>
        <form className="field-row" onSubmit={runCommand}>
          <label className="field grow">
            <span>Se ejecuta por RCON, sin “/”</span>
            <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="time set day" />
          </label>
          <button className="btn align-end" disabled={!command.trim()}>Ejecutar</button>
        </form>
        {mcResult && <div className={`mc-result ${mcResult.ok ? '' : 'error'}`}>{mcResult.text}</div>}
      </div>
    </>
  );
}
