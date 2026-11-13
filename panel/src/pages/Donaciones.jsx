import { useEffect, useState } from 'react';
import { api } from '../api.js';

const SERVICES = [
  {
    id: 'streamlabs',
    name: 'Streamlabs',
    tokenLabel: 'Socket API Token',
    how: <>En <strong>streamlabs.com</strong>: tu avatar → <strong>Account Settings → API Settings → API Tokens</strong> y copia <strong>"Your Socket API Token"</strong>.</>,
    note: 'Conexión en tiempo real. No necesita nada más.'
  },
  {
    id: 'streamelements',
    name: 'StreamElements',
    tokenLabel: 'JWT Token',
    how: <>En <strong>streamelements.com</strong>: tu avatar (arriba a la derecha) → <strong>tu canal</strong> y copia el <strong>JWT Token</strong>. Usa el de la cuenta donde recibes las propinas.</>,
    note: 'Conexión en tiempo real. No necesita nada más.'
  },
  {
    id: 'kofi',
    name: 'Ko-fi',
    tokenLabel: 'Verification Token',
    how: <>En <strong>ko-fi.com</strong>: <strong>More → API → Webhooks → Advanced</strong> y copia el <strong>Verification Token</strong>.</>,
    note: 'Ko-fi avisa por webhook: necesita un túnel (ver abajo).'
  }
];

const STATE = {
  disabled: { label: 'Desactivado', dot: 'off' },
  connecting: { label: 'Conectando…', dot: 'warn' },
  connected: { label: 'Conectado', dot: 'ok' },
  listening: { label: 'Esperando avisos de Ko-fi', dot: 'ok' },
  error: { label: 'Error', dot: 'off' }
};

export default function Donaciones() {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = () => api.donaciones().then((s) => alive && setStatus(s)).catch((e) => alive && setMsg({ type: 'error', text: e.message }));
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!status) return <><h1>Donaciones</h1>{msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}</>;

  return (
    <>
      <h1>Donaciones</h1>
      <p className="muted">
        Conecta los servicios que uses. Cada donación llega como un evento de tipo <strong>Donación</strong>: crea reglas por monto en <strong>Reglas</strong>,
        aparece en el chat de la derecha y en el overlay. Puedes dejar un servicio configurado y desactivado hasta que lo necesites.
        Los tokens se guardan solo en tu PC (<code>data/donaciones.json</code>, que no se sube a Git).
      </p>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      {SERVICES.map((svc) => (
        <ServiceCard key={svc.id} svc={svc} info={status.services[svc.id]} webhookPort={status.webhookPort}
          onChange={(s) => setStatus((st) => ({ ...st, services: { ...st.services, [svc.id]: s } }))}
          onMessage={setMsg} />
      ))}
    </>
  );
}

function ServiceCard({ svc, info, webhookPort, onChange, onMessage }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!info.hasToken);
  const [test, setTest] = useState({ amount: 50, currency: 'MXN' });
  const st = STATE[info.state] ?? STATE.disabled;

  const save = async (patch) => {
    setBusy(true);
    try {
      const res = await api.guardarDonacion(svc.id, patch);
      onChange(res);
      if ('token' in patch) { setToken(''); setEditing(false); }
      onMessage(null);
    } catch (e) { onMessage({ type: 'error', text: `${svc.name}: ${e.message}` }); } finally { setBusy(false); }
  };

  const sendTest = async () => {
    try {
      await api.probarDonacion(svc.id, { amount: Number(test.amount), currency: test.currency });
      onMessage({ type: 'ok', text: `Donación de prueba de ${svc.name} enviada. Revisa el chat de la derecha, el overlay y tus reglas de tipo Donación.` });
    } catch (e) { onMessage({ type: 'error', text: e.message }); }
  };

  return (
    <div className={`card donation-card ${info.enabled ? 'on' : ''}`}>
      <div className="row between">
        <div className="row gap">
          <h3 className="donation-name">{svc.name}</h3>
          <span className="donation-state"><span className={`dot ${st.dot}`} /> {st.label}</span>
          {info.count > 0 && <span className="muted small">· {info.count} desde que abriste la app</span>}
        </div>
        <label className="switch" title={info.enabled ? 'Desactivar' : 'Activar'}>
          <input type="checkbox" checked={info.enabled} disabled={busy || (!info.hasToken && !token)} onChange={(e) => save({ enabled: e.target.checked })} />
          <span />
        </label>
      </div>
      {info.error && <div className="banner error small-banner">{info.error}</div>}

      <p className="muted small">{svc.how} {svc.note}</p>

      <div className="field-row">
        {editing ? (
          <>
            <label className="field grow">
              <span>{svc.tokenLabel}</span>
              <div className="token-input">
                <input type={show ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pega aquí tu token" autoComplete="off" spellCheck={false} />
                <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} title={show ? 'Ocultar' : 'Mostrar'}>{show ? '🙈' : '👁'}</button>
              </div>
            </label>
            <button className="btn primary align-end" disabled={busy || !token.trim()} onClick={() => save({ token: token.trim(), enabled: true })}>Guardar y activar</button>
            <button className="btn ghost align-end" disabled={busy || !token.trim()} onClick={() => save({ token: token.trim() })}>Solo guardar</button>
            {info.hasToken && <button className="btn ghost align-end" onClick={() => { setEditing(false); setToken(''); }}>Cancelar</button>}
          </>
        ) : (
          <>
            <div className="field grow">
              <span>{svc.tokenLabel}</span>
              <div className="token-saved">Guardado <code>{info.tokenHint}</code></div>
            </div>
            <button className="btn ghost align-end" onClick={() => setEditing(true)}>Cambiar token</button>
            <button className="btn ghost danger align-end" onClick={() => confirm(`¿Borrar el token de ${svc.name}?`) && save({ token: '', enabled: false }).then(() => setEditing(true))}>Borrar</button>
          </>
        )}
      </div>

      {svc.id === 'kofi' && <KofiHelp port={webhookPort} lastWebhookAt={info.lastWebhookAt} />}

      <div className="row gap wrap test-row">
        <span className="muted small">Donación de prueba:</span>
        <input className="test-amount" type="number" min="1" value={test.amount} onChange={(e) => setTest({ ...test, amount: e.target.value })} />
        <input className="test-currency" value={test.currency} maxLength={3} onChange={(e) => setTest({ ...test, currency: e.target.value.toUpperCase() })} />
        <button className="btn small" onClick={sendTest}>Probar</button>
        <span className="muted small">Funciona aunque el servicio esté desactivado: simula que llegó una donación de {svc.name}.</span>
      </div>
    </div>
  );
}

function KofiHelp({ port, lastWebhookAt }) {
  const [copied, setCopied] = useState(null);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  const cmd = `cloudflared tunnel --url http://localhost:${port}`;
  return (
    <details className="kofi-help">
      <summary>Cómo conectar Ko-fi (túnel) {lastWebhookAt && <span className="muted small">· último aviso: {new Date(lastWebhookAt).toLocaleString('es-MX')}</span>}</summary>
      <ol className="steps">
        <li>Instala <strong>Cloudflare Tunnel</strong> (<code>cloudflared</code>), que es gratis: en PowerShell, <code>winget install --id Cloudflare.cloudflared</code>.</li>
        <li>
          Con la app abierta, ejecuta en otra terminal:
          <div className="copy-line"><code>{cmd}</code><button className="btn small" onClick={() => copy(cmd)}>{copied === cmd ? '✓' : 'Copiar'}</button></div>
          Te dará una URL como <code>https://algo-al-azar.trycloudflare.com</code>.
        </li>
        <li>En Ko-fi (<strong>More → API → Webhooks</strong>) pega esa URL agregándole <code>/webhooks/kofi</code> al final, y presiona <strong>Update</strong>.</li>
        <li>Usa <strong>Send Single Donation Test</strong> en Ko-fi: debe aparecer en el chat de la derecha.</li>
      </ol>
      <p className="muted small">
        El túnel apunta al puerto <strong>{port}</strong>, que solo acepta avisos de Ko-fi con tu token; el panel de la app no queda expuesto.
        La URL gratuita cambia cada vez que inicias el túnel: actualízala en Ko-fi cuando la vuelvas a abrir (o crea un túnel con nombre fijo en Cloudflare).
      </p>
    </details>
  );
}
