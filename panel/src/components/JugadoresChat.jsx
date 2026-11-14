import { useEffect, useState } from 'react';
import { api } from '../api.js';

const NAME = /^[A-Za-z0-9_]{3,16}$/;

/** Apodos (cómo te escribe el chat → cuenta de Minecraft) y jugadores protegidos. */
export default function JugadoresChat() {
  const [data, setData] = useState(null);
  const [aliases, setAliases] = useState([]);
  const [newProt, setNewProt] = useState('');
  const [msg, setMsg] = useState(null);
  const [online, setOnline] = useState([]);

  const apply = (d) => { setData(d); setAliases(Object.entries(d.aliases).map(([alias, account]) => ({ alias, account }))); };
  useEffect(() => {
    api.jugadoresChat().then(apply).catch((e) => setMsg({ type: 'error', text: e.message }));
    api.jugadores().then((p) => setOnline(p.players ?? [])).catch(() => {});
  }, []);

  const flash = (text, type = 'ok') => { setMsg({ text, type }); if (type === 'ok') setTimeout(() => setMsg(null), 3000); };
  const save = async (patch, ok = 'Guardado.') => {
    try { apply(await api.guardarJugadoresChat(patch)); flash(ok); } catch (e) { flash(e.message, 'error'); }
  };

  if (!data) return null;
  const dirty = JSON.stringify(Object.fromEntries(aliases.filter((a) => a.alias || a.account).map((a) => [a.alias.toLowerCase(), a.account]))) !== JSON.stringify(data.aliases);
  const setAlias = (i, patch) => setAliases((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const addProt = (name) => {
    const n = name.trim();
    if (!NAME.test(n) || data.protected.some((p) => p.toLowerCase() === n.toLowerCase())) return;
    save({ protected: [...data.protected, n] }, `${n} ya no recibe cosas del chat.`);
    setNewProt('');
  };
  const suggestions = online.filter((n) => n.toLowerCase() !== data.me.toLowerCase() && !data.protected.some((p) => p.toLowerCase() === n.toLowerCase()));

  return (
    <div className="card">
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}
      <p className="muted small">
        Para las reglas cuyo objetivo es <strong>“Lo elige el chat”</strong>, <strong>“Al azar”</strong> o <strong>“Todos”</strong>.
        Tú (<code>{data.me}</code>) siempre puedes recibir.
      </p>

      <h3>Apodos</h3>
      <p className="muted small">Si el chat le dice “Many” a tu amigo pero su cuenta es otra, agrégalo aquí. Las cuentas también se aceptan tal cual, sin importar mayúsculas.</p>
      <div className="alias-list">
        {aliases.map((a, i) => (
          <div key={i} className="alias-row">
            <input value={a.alias} placeholder="Many" onChange={(e) => setAlias(i, { alias: e.target.value.replace(/\s/g, '') })} />
            <span className="muted">→</span>
            <input value={a.account} placeholder="CuentaDeMinecraft" list="online-players" onChange={(e) => setAlias(i, { account: e.target.value.replace(/\s/g, '') })} />
            <button className="icon-btn danger" title="Quitar" onClick={() => setAliases((list) => list.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <datalist id="online-players">{online.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      <div className="row gap">
        <button className="btn small ghost" onClick={() => setAliases((l) => [...l, { alias: '', account: '' }])}>+ Apodo</button>
        {dirty && <button className="btn small primary" onClick={() => save({ aliases: Object.fromEntries(aliases.filter((a) => a.alias || a.account).map((a) => [a.alias, a.account])) }, 'Apodos guardados.')}>Guardar apodos</button>}
      </div>

      <h3 className="mt">Protegidos</h3>
      <p className="muted small">No reciben nada del chat: no se pueden elegir, no salen en “Al azar” y se excluyen de “Todos”.</p>
      <div className="wl-list">
        {data.protected.length === 0 && <span className="muted small">Nadie está protegido.</span>}
        {data.protected.map((p) => (
          <span key={p} className="wl-chip">
            🛡️ {p}
            <button className="icon-btn danger" title={`Quitar protección a ${p}`} onClick={() => save({ protected: data.protected.filter((x) => x !== p) }, `${p} ya puede recibir cosas del chat.`)}>✕</button>
          </span>
        ))}
      </div>
      <form className="row gap mt-s" onSubmit={(e) => { e.preventDefault(); addProt(newProt); }}>
        <input value={newProt} onChange={(e) => setNewProt(e.target.value.replace(/\s/g, ''))} placeholder="CuentaDeMinecraft" maxLength={16} list="online-players" />
        <button className="btn small" disabled={!NAME.test(newProt)}>Proteger</button>
        {suggestions.map((n) => <button type="button" key={n} className="btn small ghost" onClick={() => addProt(n)}>🛡️ {n}</button>)}
      </form>
    </div>
  );
}
