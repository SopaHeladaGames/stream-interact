import { useEffect, useState } from 'react';
import { api } from '../api.js';

const NAME = /^[A-Za-z0-9_]{3,16}$/;

/** Conectarse desde la red local, jugadores conectados y lista blanca. */
export default function ServidorJugadores({ rcon }) {
  const [net, setNet] = useState(null);
  const [online, setOnline] = useState(null);
  const [wl, setWl] = useState(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [editPub, setEditPub] = useState(false);
  const [pubDraft, setPubDraft] = useState('');

  useEffect(() => { api.servidorRed().then(setNet).catch(() => {}); }, [rcon]);

  // Jugadores y lista blanca: se actualizan cada 5 s mientras haya RCON
  useEffect(() => {
    let alive = true;
    const tick = () => {
      api.jugadores().then((p) => alive && setOnline(p)).catch(() => {});
      api.whitelist().then((w) => alive && setWl(w)).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [rcon]);

  const flash = (text, type = 'ok') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 4000); };

  const wlAction = async (action, who) => {
    setBusy(true);
    try {
      const res = await api.whitelistAccion(action, who);
      setWl(res);
      flash(res.response);
      if (action === 'add') setName('');
      api.servidorRed().then(setNet).catch(() => {});
    } catch (e) { flash(e.message, 'error'); } finally { setBusy(false); }
  };

  const kick = async (who) => {
    if (!confirm(`¿Expulsar a ${who} del servidor? Podrá volver a entrar si está en la lista blanca.`)) return;
    try {
      const res = await api.expulsar(who);
      flash(res.response);
      api.jugadores().then(setOnline).catch(() => {});
    } catch (e) { flash(e.message, 'error'); }
  };

  const savePublic = async (value) => {
    try {
      const res = await api.direccionPublica(value);
      setNet(res);
      setEditPub(false);
      flash(value ? 'Dirección pública guardada.' : 'Dirección pública quitada.');
    } catch (e) { flash(e.message, 'error'); }
  };

  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1500); }).catch(() => {});

  const lanIps = (net?.addresses ?? []).filter((a) => a.lan && !a.virtual);
  const otherIps = (net?.addresses ?? []).filter((a) => !(a.lan && !a.virtual));
  const withPort = (ip) => (net?.port && net.port !== 25565 ? `${ip}:${net.port}` : ip);
  const whitelistOn = wl?.enabled ?? net?.whitelistInFile;
  const onlineSet = new Set(online?.players ?? []);
  const validName = NAME.test(name.trim());

  return (
    <>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      <div className="server-grid">
        {/* ---------- Red local ---------- */}
        <div className="card">
          <h3>Conectarse al servidor</h3>
          <div className="net-label">Desde fuera de tu casa</div>
          {net?.publicAddress && !editPub && (
            <div className="ip-line">
              <code className="ip-big public">{net.publicAddress}</code>
              <button className="btn small" onClick={() => copy(net.publicAddress)}>{copied === net.publicAddress ? '✓ Copiada' : 'Copiar'}</button>
              <button className="btn small ghost" onClick={() => { setPubDraft(net.publicAddress); setEditPub(true); }}>Cambiar</button>
            </div>
          )}
          {(editPub || (net && !net.publicAddress)) && (
            <form className="ip-line" onSubmit={(e) => { e.preventDefault(); savePublic(pubDraft); }}>
              <input className="grow" value={pubDraft} onChange={(e) => setPubDraft(e.target.value.trim())} placeholder="algo.tun.ply.gg (la que te da Playit)" />
              <button className="btn small primary" disabled={!pubDraft}>Guardar</button>
              {editPub && <button type="button" className="btn small ghost" onClick={() => setEditPub(false)}>Cancelar</button>}
              {editPub && net?.publicAddress && <button type="button" className="btn small ghost danger" onClick={() => savePublic('')}>Quitar</button>}
            </form>
          )}
          <p className="muted small">
            {net?.publicAddress
              ? 'Funciona mientras Playit esté corriendo en esta PC. Solo entran quienes estén en la lista blanca.'
              : 'Pega aquí la dirección de tu túnel de Playit.gg para tenerla a mano.'}
          </p>
          <div className="net-label">Desde tu misma red</div>
          {lanIps.length === 0 && <p className="muted small">No encontré una IP de red local en esta PC.</p>}
          {lanIps.map((a) => (
            <div key={a.address} className="ip-line">
              <code className="ip-big">{withPort(a.address)}</code>
              <button className="btn small" onClick={() => copy(withPort(a.address))}>{copied === withPort(a.address) ? '✓ Copiada' : 'Copiar'}</button>
              <span className="muted small">{a.iface}</span>
            </div>
          ))}
          <p className="muted small">
            Quien esté en tu misma red entra en Minecraft con <strong>Multijugador → Conexión directa</strong> y esta dirección.
            Tú puedes entrar con <code>localhost</code>.
          </p>
          {otherIps.length > 0 && (
            <details className="small-details">
              <summary className="muted small">Otras direcciones de esta PC ({otherIps.length})</summary>
              {otherIps.map((a) => <div key={a.address} className="muted small"><code>{a.address}</code> · {a.iface}{a.virtual ? ' (virtual o VPN)' : ''}</div>)}
            </details>
          )}
          {net && (
            <div className="server-flags">
              <span className={`pill ${net.onlineMode ? 'ok' : 'warn'}`} title="online-mode en server.properties">
                {net.onlineMode ? 'Solo cuentas oficiales' : 'online-mode desactivado'}
              </span>
              {net.maxPlayers && <span className="pill off">Máx. {net.maxPlayers} jugadores</span>}
              <span className="pill off">Puerto {net.port}</span>
            </div>
          )}
        </div>

        {/* ---------- Jugadores conectados ---------- */}
        <div className="card">
          <div className="row between">
            <h3>Jugadores conectados</h3>
            {online?.connected && <span className="muted small">{online.count}{online.max ? ` / ${online.max}` : ''}</span>}
          </div>
          {!online?.connected && <p className="muted small">Enciende el servidor para ver quién está conectado.</p>}
          {online?.connected && online.players.length === 0 && <p className="muted small">No hay nadie conectado.</p>}
          <div className="player-list">
            {online?.players.map((p) => (
              <div key={p} className="player">
                <img className="player-head" src={`https://mc-heads.net/avatar/${encodeURIComponent(p)}/28`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <span className="player-name">{p}</span>
                {wl?.players && !wl.players.includes(p) && whitelistOn && <span className="pill warn" title="Entró antes de que se activara la lista blanca">fuera de la lista</span>}
                <button className="btn small ghost danger" onClick={() => kick(p)}>Expulsar</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Lista blanca ---------- */}
      <div className="card">
        <div className="row between">
          <div className="row gap">
            <h3 className="no-margin">Lista blanca</h3>
            <span className={`pill ${whitelistOn ? 'ok' : 'warn'}`}>{whitelistOn ? 'Activada' : 'Desactivada'}</span>
          </div>
          <label className="switch" title={whitelistOn ? 'Desactivar (cualquiera podría entrar)' : 'Activar'}>
            <input type="checkbox" checked={Boolean(whitelistOn)} disabled={busy || !rcon}
              onChange={(e) => (e.target.checked || confirm('Sin lista blanca, cualquiera que tenga tu dirección puede entrar a tu servidor. ¿Desactivarla?')) && wlAction(e.target.checked ? 'on' : 'off')} />
            <span />
          </label>
        </div>
        <p className="muted small">
          {whitelistOn
            ? 'Solo pueden entrar los jugadores de esta lista. Usa el nombre exacto de su cuenta de Minecraft.'
            : 'Desactivada: cualquiera con la dirección del servidor puede entrar. Te recomiendo activarla si alguien de fuera puede conectarse.'}
        </p>
        <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (validName) wlAction('add', name.trim()); }}>
          <label className="field grow">
            <span>Agregar jugador</span>
            <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} placeholder="NombreDeMinecraft" maxLength={16} disabled={!rcon} />
          </label>
          <button className="btn primary align-end" disabled={busy || !rcon || !validName}>Agregar</button>
        </form>
        {!rcon && <p className="muted small">Enciende el servidor para administrar la lista blanca.</p>}
        <div className="wl-list">
          {wl?.connected && wl.players.length === 0 && <span className="muted small">La lista está vacía.</span>}
          {wl?.players.map((p) => (
            <span key={p} className="wl-chip">
              <img src={`https://mc-heads.net/avatar/${encodeURIComponent(p)}/20`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              {p}
              {onlineSet.has(p) && <span className="dot ok" title="Conectado" />}
              <button className="icon-btn danger" title={`Quitar a ${p}`} disabled={busy}
                onClick={() => confirm(`¿Quitar a ${p} de la lista blanca? Ya no podrá entrar.`) && wlAction('remove', p)}>✕</button>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
