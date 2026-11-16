import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { name: '', dir: '', java: '', memoryMin: '', memoryMax: '', extraArgs: '', acceptEula: false };
const TYPE_CLASS = { paper: 'ok', purpur: 'ok', vanilla: 'ok', fabric: 'mod', quilt: 'mod', neoforge: 'mod', forge: 'mod', jar: 'off', unknown: 'warn' };

export default function Instalaciones({ go }) {
  const [data, setData] = useState(null);
  const [javas, setJavas] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.instalaciones().then(setData).catch((e) => setMsg({ type: 'error', text: e.message }));
  useEffect(() => {
    load();
    api.javas().then((r) => setJavas(r.found)).catch(() => {});
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const flash = (text, type = 'ok') => { setMsg({ text, type }); if (type === 'ok') setTimeout(() => setMsg(null), 4000); };
  const running = data && ['starting', 'running', 'stopping', 'external'].includes(data.server?.state);

  const activate = async (item, start = false) => {
    setBusy(true);
    try {
      setData(await api.activarInstalacion(item.id, start));
      flash(start ? `Iniciando "${item.name}"…` : `"${item.name}" es ahora la instalación activa.`);
      if (start) go?.('servidor');
    } catch (e) { flash(e.message, 'error'); } finally { setBusy(false); }
  };

  const remove = async (item) => {
    if (!confirm(`¿Quitar "${item.name}" del panel?\n\nNo se borra ningún archivo: la carpeta ${item.dir} se queda igual y la puedes volver a agregar.`)) return;
    try { await api.quitarInstalacion(item.id); load(); flash(`"${item.name}" se quitó del panel.`); } catch (e) { flash(e.message, 'error'); }
  };

  if (!data) return <h1>Instalaciones</h1>;

  return (
    <>
      <div className="section-head">
        <h1>Instalaciones</h1>
        <button className="btn primary" onClick={() => setEditing('new')} disabled={editing === 'new'}>+ Agregar instalación</button>
      </div>

      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}
      <p className="muted">
        Cada instalación es una carpeta con su propio mundo, lista blanca, mods o plugins. Solo una corre a la vez, siempre en el
        puerto 25565, así que la dirección de Playit y tu IP local no cambian.
      </p>
      {running && <div className="banner warn">El servidor está encendido. Para cambiar de instalación primero detenlo en la página Servidor.</div>}

      {editing === 'new' && (
        <InstallForm javas={javas} canPick={data.canPick} defaults={data.defaults} onCancel={() => setEditing(null)}
          onSaved={(item) => { setEditing(null); load(); flash(`"${item.name}" agregada.`); }} />
      )}

      {data.items.length === 0 && editing !== 'new' && (
        <div className="card empty-card">Aún no tienes instalaciones. Agrega la carpeta de tu servidor con <strong>+ Agregar instalación</strong>.</div>
      )}

      <div className="install-grid">
        {data.items.map((item) => editing === item.id ? (
          <InstallForm key={item.id} item={item} javas={javas} canPick={data.canPick} defaults={data.defaults} onCancel={() => setEditing(null)}
            onSaved={(it) => { setEditing(null); load(); flash(`"${it.name}" guardada.`); }} />
        ) : (
          <InstallCard key={item.id} item={item} active={data.active === item.id} running={running} busy={busy} defaults={data.defaults}
            onActivate={() => activate(item)} onStart={() => activate(item, true)} onEdit={() => setEditing(item.id)} onRemove={() => remove(item)} />
        ))}
      </div>

      <details className="card help-card">
        <summary><strong>¿Cómo preparo una instalación con mods?</strong></summary>
        <ol>
          <li>Crea una carpeta nueva, por ejemplo <code>C:\Users\vitro\dev\mc-create</code>.</li>
          <li>
            <strong>Fabric:</strong> descarga el <em>server launcher</em> desde fabricmc.net/use/server (elige la versión de Minecraft) y guárdalo en esa carpeta.<br />
            <strong>NeoForge / Forge:</strong> abre su instalador, elige <em>Install server</em> y apunta a esa carpeta.
          </li>
          <li>Pon los mods del servidor en la carpeta <code>mods</code> (créala si no existe).</li>
          <li>Agrégala aquí con <strong>+ Agregar instalación</strong>, acepta el EULA y elige la versión de Java correcta.</li>
          <li>Tus amigos necesitan la <strong>misma versión de Minecraft y los mismos mods</strong> en su juego.</li>
        </ol>
        <p className="muted small">
          Java según la versión: Minecraft 26.x pide Java 25 · 1.20.5 a 1.21.x pide Java 21 · 1.18 a 1.20.4 pide Java 17.
          Los modpacks suelen necesitar más RAM (6G u 8G).
        </p>
        <p className="muted small">
          Al iniciar, la app ajusta en <code>server.properties</code> el puerto (25565) y RCON para poder controlarla igual que las demás.
          Tus reglas de Twitch usan comandos de Minecraft normales, así que funcionan en cualquier instalación.
        </p>
      </details>
    </>
  );
}

function InstallCard({ item, active, running, busy, defaults, onActivate, onStart, onEdit, onRemove }) {
  const { info } = item;
  const problems = [];
  if (!info.exists) problems.push('La carpeta ya no existe');
  else if (!info.launch) problems.push('No encontré un servidor en la carpeta');
  else if (!info.eula) problems.push('Falta aceptar el EULA (Editar)');
  const ok = problems.length === 0;

  return (
    <div className={`card install-card ${active ? 'active' : ''}`}>
      <div className="row between">
        <div className="row gap wrap">
          <h3 className="no-margin">{item.name}</h3>
          <span className={`pill ${TYPE_CLASS[info.type] ?? 'off'}`}>{info.label}{info.version ? ` ${info.version}` : ''}</span>
          {active && <span className="pill active-pill">Activa</span>}
        </div>
      </div>
      <code className="install-dir" title={item.dir}>{item.dir}</code>
      <div className="install-facts">
        {info.mods > 0 && <span>🧩 {info.mods} mods</span>}
        {info.plugins > 0 && <span>🔌 {info.plugins} plugins</span>}
        <span>{info.world ? '🌍 Mundo creado' : '🌱 Mundo nuevo al iniciar'}</span>
        <span>🧠 {item.memoryMin || defaults.memoryMin}–{item.memoryMax || defaults.memoryMax}</span>
        <span title={item.java || defaults.java}>☕ {item.java ? shortJava(item.java) : 'Java del .env'}</span>
      </div>
      {problems.map((p) => <div key={p} className="install-problem">⚠ {p}</div>)}
      {info.type === 'paper' && info.exists && <PaperUpdate id={item.id} restartsServer={active && running} />}
      <div className="row gap wrap install-actions">
        {!active && <button className="btn small" onClick={onActivate} disabled={busy || running}>Usar esta</button>}
        <button className="btn small primary" onClick={onStart} disabled={busy || running || !ok}>{active ? '▶ Iniciar' : '▶ Usar e iniciar'}</button>
        <button className="btn small ghost" onClick={onEdit}>Editar</button>
        {!active && <button className="btn small ghost danger" onClick={onRemove}>Quitar</button>}
      </div>
    </div>
  );
}

const PHASES = {
  buscando: 'Buscando el build más nuevo…',
  descargando: 'Descargando',
  verificando: 'Verificando el archivo…',
  deteniendo: 'Deteniendo el servidor…',
  reemplazando: 'Cambiando el .jar…',
  iniciando: 'Iniciando el servidor…'
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '');
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Revisa si hay un build más nuevo de Paper y lo instala con un clic. */
function PaperUpdate({ id, restartsServer }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);
  const [note, setNote] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async (force = false) => {
    setChecking(true);
    try {
      const r = await api.paperInfo(id, force);
      setInfo(r); setError(null);
      if (r.job && !r.job.done) setJob(r.job);
    } catch (e) { setError(e.message); } finally { setChecking(false); }
  };
  useEffect(() => { check(); }, [id]);

  // Mientras actualiza, preguntar el avance
  const working = job && !job.done;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => {
      try {
        const { job: j } = await api.paperEstado(id);
        if (!j) return;
        setJob(j);
        if (j.done) {
          if (j.phase === 'listo') setNote({ type: 'ok', text: `✓ Paper actualizado al build ${j.to}${j.restarted ? '. El servidor se está iniciando de nuevo.' : '. Se usará la próxima vez que inicies el servidor.'}` });
          else if (j.phase === 'al-dia') setNote({ type: 'ok', text: '✓ Ya estaba al día.' });
          else setNote({ type: 'error', text: j.error });
          check(true);
        }
      } catch { /* reintenta en el siguiente ciclo */ }
    }, 700);
    return () => clearInterval(t);
  }, [working, id]);

  const update = async () => {
    const msg = restartsServer
      ? `¿Actualizar Paper al build ${info.latest.build}?\n\nEl servidor está encendido: primero se descarga el nuevo .jar y luego se reinicia (los jugadores se desconectan unos segundos y pueden volver a entrar).`
      : `¿Actualizar Paper al build ${info.latest.build}?`;
    if (!confirm(msg)) return;
    setNote(null);
    try { setJob((await api.actualizarPaper(id)).job); } catch (e) { setNote({ type: 'error', text: e.message }); }
  };

  const revert = async () => {
    if (!confirm('¿Regresar al .jar de Paper que tenías antes de la última actualización?')) return;
    try { setInfo(await api.revertirPaper(id)); setNote({ type: 'ok', text: '↩ Regresaste a la versión anterior de Paper.' }); } catch (e) { setNote({ type: 'error', text: e.message }); }
  };

  const pct = job?.total ? Math.min(100, Math.round((job.received / job.total) * 100)) : null;

  return (
    <div className="paper-update">
      {!info && !error && <div className="muted small">Buscando actualizaciones de Paper…</div>}
      {error && !info && (
        <div className="row between gap">
          <span className="muted small">No pude revisar actualizaciones de Paper: {error}</span>
          <button className="btn small ghost" onClick={() => check(true)} disabled={checking}>Reintentar</button>
        </div>
      )}
      {info && (
        <>
          <div className="row between gap wrap">
            <div className="paper-line">
              <strong>Paper {info.mc}</strong>
              <span className="muted"> · build {info.current?.build ?? '?'}{info.current?.time ? ` (${fmtDate(info.current.time)})` : ''}</span>
              {info.upToDate
                ? <span className="pill ok">✓ Al día</span>
                : <span className="pill warn">Build {info.latest.build} disponible{info.behind ? ` · ${info.behind} atrás` : ''}</span>}
              {info.latest.channel && info.latest.channel !== 'STABLE' && <span className="pill off" title="PaperMC aún no marca como estable ningún build de esta versión">{info.latest.channel.toLowerCase()}</span>}
            </div>
            <div className="row gap">
              {!info.upToDate && <button className="btn small primary" onClick={update} disabled={working}>⬆ Actualizar Paper</button>}
              <button className="btn small ghost" onClick={() => check(true)} disabled={checking || working} title="Volver a buscar">↻</button>
            </div>
          </div>

          {working && (
            <div className="paper-job">
              <div className="small">{PHASES[job.phase] ?? job.phase}{job.phase === 'descargando' && job.total ? ` ${mb(job.received)} de ${mb(job.total)}` : ''}</div>
              <div className="paper-progress"><span style={{ width: `${job.phase === 'descargando' ? (pct ?? 5) : 100}%` }} /></div>
            </div>
          )}
          {note && <div className={`small paper-note ${note.type}`}>{note.text}</div>}

          {!info.upToDate && info.changes.length > 0 && (
            <details className="paper-changes">
              <summary className="small">Qué cambió</summary>
              <ul>{info.changes.map((c, i) => <li key={i}><span className="muted">#{c.build}</span> {c.message}</li>)}</ul>
            </details>
          )}
          {info.current && !info.current.exact && <div className="muted small">El build instalado lo tomé de lo que Paper anotó al arrancar.</div>}
          {info.newerMc && (
            <div className="muted small">
              Ya existe Paper para Minecraft {info.newerMc}. Ese salto no se hace desde aquí: convierte el mundo (no se puede deshacer)
              y tus amigos tendrían que actualizar su juego.
            </div>
          )}
          {info.hasPrevious && !working && (
            <button className="link-btn small" onClick={revert} disabled={restartsServer} title={restartsServer ? 'Detén el servidor primero' : ''}>↩ Regresar a la versión anterior</button>
          )}
        </>
      )}
    </div>
  );
}

function shortJava(p) {
  const m = /([^\\/]+)[\\/]bin[\\/]java(\.exe)?$/i.exec(p);
  return m ? m[1] : p;
}

function InstallForm({ item, javas, canPick, defaults, onCancel, onSaved }) {
  const [form, setForm] = useState(() => (item ? { ...EMPTY, ...item, java: item.java ?? '', memoryMin: item.memoryMin ?? '', memoryMax: item.memoryMax ?? '', extraArgs: item.extraArgs ?? '' } : EMPTY));
  const [info, setInfo] = useState(item?.info ?? null);
  const [customJava, setCustomJava] = useState(() => Boolean(item?.java) && !javas.some((j) => j.path === item.java));
  const [javaVer, setJavaVer] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Revisar la carpeta cuando cambia (qué servidor tiene, mods, EULA…)
  useEffect(() => {
    if (!form.dir.trim()) { setInfo(null); return; }
    const t = setTimeout(() => api.revisarInstalacion(form.dir).then(setInfo).catch(() => setInfo(null)), 400);
    return () => clearTimeout(t);
  }, [form.dir]);

  // Versión del Java elegido
  useEffect(() => {
    setJavaVer(null);
    const t = setTimeout(() => api.versionJava(form.java || defaults.java).then((r) => setJavaVer(r.version ?? 'no encontrado')).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [form.java, defaults.java]);

  const pick = async () => {
    try {
      const { dir } = await api.elegirCarpeta();
      if (dir) setForm((f) => ({ ...f, dir, name: f.name || dir.split(/[\\/]/).pop() }));
    } catch (e) { setError(e.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = { name: form.name, dir: form.dir, java: form.java, memoryMin: form.memoryMin, memoryMax: form.memoryMax, extraArgs: form.extraArgs, acceptEula: form.acceptEula };
      onSaved(item ? await api.editarInstalacion(item.id, body) : await api.agregarInstalacion(body));
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const javaSelect = customJava ? '__custom' : form.java;

  return (
    <form className="card install-form" onSubmit={submit}>
      <h3>{item ? `Editar "${item.name}"` : 'Nueva instalación'}</h3>
      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}

      <div className="field-row">
        <label className="field grow">
          <span>Nombre</span>
          <input value={form.name} onChange={set('name')} placeholder="Vanilla, Create con amigos, Modpack terror…" maxLength={40} required />
        </label>
      </div>

      <div className="field-row">
        <label className="field grow">
          <span>Carpeta del servidor</span>
          <input value={form.dir} onChange={set('dir')} placeholder="C:\Users\vitro\dev\mc-server" required />
        </label>
        {canPick && <button type="button" className="btn align-end" onClick={pick}>Examinar…</button>}
      </div>
      {info && (
        <div className={`detect ${info.launch ? 'ok' : 'warn'}`}>
          {!info.exists ? '⚠ Esa carpeta no existe.'
            : !info.launch ? '⚠ No encontré un servidor aquí: falta el .jar (Paper, Vanilla, Fabric) o la instalación de NeoForge/Forge.'
              : <>✓ {info.label}{info.version ? ` ${info.version}` : ''}{info.launch.kind === 'jar' ? ` · ${info.launch.jar}` : ' · se arranca como su run.bat'}
                {info.mods > 0 && ` · ${info.mods} mods`}{info.plugins > 0 && ` · ${info.plugins} plugins`}{info.world ? ' · ya tiene mundo' : ' · el mundo se crea al iniciar'}</>}
        </div>
      )}

      <div className="field-row">
        <label className="field grow">
          <span>Java</span>
          <select value={javaSelect} onChange={(e) => {
            if (e.target.value === '__custom') { setCustomJava(true); return; }
            setCustomJava(false); setForm((f) => ({ ...f, java: e.target.value }));
          }}>
            <option value="">El del .env ({defaults.java})</option>
            {javas.map((j) => <option key={j.path} value={j.path}>Java {j.version ?? '?'} · {j.vendor} ({j.name})</option>)}
            <option value="__custom">Otra ruta…</option>
          </select>
        </label>
        {customJava && (
          <label className="field grow">
            <span>Ruta de java.exe</span>
            <input value={form.java} onChange={set('java')} placeholder="C:\Program Files\...\bin\java.exe" />
          </label>
        )}
        <div className="field narrow">
          <span>Versión</span>
          <div className="java-ver">{javaVer ?? '…'}</div>
        </div>
      </div>

      <div className="field-row">
        <label className="field narrow">
          <span>RAM mínima</span>
          <input value={form.memoryMin} onChange={set('memoryMin')} placeholder={defaults.memoryMin} />
        </label>
        <label className="field narrow">
          <span>RAM máxima</span>
          <input value={form.memoryMax} onChange={set('memoryMax')} placeholder={defaults.memoryMax} />
        </label>
        <label className="field grow">
          <span>Argumentos extra de Java (opcional)</span>
          <input value={form.extraArgs} onChange={set('extraArgs')} placeholder="-XX:+UseG1GC" />
        </label>
      </div>

      {info?.exists && info.launch && !info.eula && (
        <label className="check eula">
          <input type="checkbox" checked={form.acceptEula} onChange={set('acceptEula')} />
          Acepto el EULA de Minecraft (aka.ms/MinecraftEULA). Sin esto el servidor no arranca.
        </label>
      )}

      <div className="row gap">
        <button className="btn primary" disabled={saving}>{saving ? 'Guardando…' : item ? 'Guardar' : 'Agregar'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
