import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const ORIGIN = 'http://localhost:3000';
const URLS = [
  { id: 'todo', label: 'Todo (alertas + votación)', path: '/overlay', hint: 'Una sola fuente para todo. La más sencilla.' },
  { id: 'alertas', label: 'Solo alertas', path: '/overlay?widget=alertas', hint: 'Para acomodar las alertas por separado.' },
  { id: 'votacion', label: 'Solo votación', path: '/overlay?widget=votacion', hint: 'Para acomodar la votación por separado.' }
];
const KINDS = [
  { id: 'reward', label: 'Canje', icon: '🎁' },
  { id: 'cheer', label: 'Bits', icon: '💎' },
  { id: 'donation', label: 'Donación', icon: '💵' },
  { id: 'command', label: 'Comando', icon: '💬' },
  { id: 'poll', label: 'Votación', icon: '🗳️' },
  { id: 'chaos', label: 'Caos', icon: '⚡' }
];
const POSITIONS = [
  ['top-left', 'top-center', 'top-right'],
  [null, 'center', null],
  ['bottom-left', 'bottom-center', 'bottom-right']
];
const POSITION_LABELS = {
  'top-left': 'Arriba a la izquierda', 'top-center': 'Arriba al centro', 'top-right': 'Arriba a la derecha', center: 'Centro',
  'bottom-left': 'Abajo a la izquierda', 'bottom-center': 'Abajo al centro', 'bottom-right': 'Abajo a la derecha'
};
const ANIM_IN = [
  ['pop', 'Rebote (salta y crece)'], ['drop', 'Caída con rebotes'], ['slide-down', 'Deslizar desde arriba'],
  ['slide-up', 'Deslizar desde abajo'], ['slide-right', 'Entrar por la izquierda'], ['slide-left', 'Entrar por la derecha'],
  ['zoom', 'Zoom'], ['flip', 'Voltear'], ['fade', 'Aparecer suave']
];
const ANIM_OUT = [
  ['rise', 'Subir y desvanecer'], ['fade', 'Desvanecer'], ['slide-up', 'Salir por arriba'], ['slide-down', 'Salir por abajo'],
  ['slide-left', 'Salir por la izquierda'], ['slide-right', 'Salir por la derecha'], ['zoom', 'Agrandar y desvanecer'], ['shrink', 'Encoger']
];
const FONTS = [
  ['segoe', 'Segoe UI (normal)'], ['inter', 'Inter (moderna, gruesa)'], ['fredoka', 'Fredoka (redondeada)'],
  ['bebas', 'Bebas Neue (alta, impactante)'], ['pixel', 'Press Start 2P (pixel, retro)'], ['vt323', 'VT323 (terminal retro)'], ['mono', 'Consolas (monoespaciada)']
];
const THEMES = [
  { id: 'clasico', label: 'Clásico', swatch: ['#9b6bff', '#201834'], patch: {
    font: 'segoe', textScale: 1, textColor: '#ffffff', titleAccent: true, bgStyle: 'gradient', bgColor: '#14121e', bgColor2: '#201834', bgOpacity: 0.94,
    borderWidth: 3, radius: 26, glow: true, shine: true, iconMotion: true, animIn: 'pop', animOut: 'rise', animSpeed: 1,
    colors: { reward: '#9b6bff', cheer: '#ffb347', donation: '#3ddc84', command: '#4cc3ff', poll: '#ffb347', chaos: '#ff4d5e' } } },
  { id: 'neon', label: 'Neón', swatch: ['#ff3df2', '#0b0b18'], patch: {
    font: 'inter', textScale: 1, textColor: '#ffffff', titleAccent: true, bgStyle: 'gradient', bgColor: '#07070f', bgColor2: '#150a2b', bgOpacity: 0.92,
    borderWidth: 4, radius: 18, glow: true, shine: true, iconMotion: true, animIn: 'zoom', animOut: 'zoom', animSpeed: 1.1,
    colors: { reward: '#ff3df2', cheer: '#ffe14d', donation: '#3dff8a', command: '#3df2ff', poll: '#ffe14d', chaos: '#ff3d5a' } } },
  { id: 'minimal', label: 'Minimal', swatch: ['#e8e8f0', '#101014'], patch: {
    font: 'inter', textScale: 0.85, textColor: '#f2f2f7', titleAccent: true, bgStyle: 'solid', bgColor: '#101014', bgColor2: '#101014', bgOpacity: 0.85,
    borderWidth: 0, radius: 12, glow: false, shine: false, iconMotion: false, animIn: 'fade', animOut: 'fade', animSpeed: 1,
    colors: { reward: '#b9a2ff', cheer: '#ffd08a', donation: '#9ff0bf', command: '#9fdcff', poll: '#ffd08a', chaos: '#ff8a96' } } },
  { id: 'pixel', label: 'Pixel', swatch: ['#55ff55', '#1d1d1d'], patch: {
    font: 'pixel', textScale: 1, textColor: '#ffffff', titleAccent: true, bgStyle: 'solid', bgColor: '#1d1d1d', bgColor2: '#1d1d1d', bgOpacity: 0.95,
    borderWidth: 6, radius: 0, glow: false, shine: false, iconMotion: true, animIn: 'drop', animOut: 'slide-up', animSpeed: 1,
    colors: { reward: '#55ff55', cheer: '#ffff55', donation: '#55ff55', command: '#55ffff', poll: '#ffaa00', chaos: '#ff5555' } } },
  { id: 'sinfondo', label: 'Sin fondo', swatch: ['#ffffff', '#555555'], patch: {
    font: 'bebas', textScale: 1.3, textColor: '#ffffff', titleAccent: true, bgStyle: 'none', borderWidth: 0, radius: 0,
    glow: false, shine: false, iconMotion: true, animIn: 'slide-right', animOut: 'slide-left', animSpeed: 1,
    colors: { reward: '#c9a8ff', cheer: '#ffc670', donation: '#8cf0b4', command: '#7fd4ff', poll: '#ffc670', chaos: '#ff7080' } } }
];
const TABS = [
  { id: 'posicion', label: 'Posición' },
  { id: 'animacion', label: 'Animación' },
  { id: 'estilo', label: 'Estilo' },
  { id: 'medios', label: 'Imágenes y sonidos' }
];

export default function Overlay() {
  const [config, setConfig] = useState(null);
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);
  const [tab, setTab] = useState('posicion');
  const [demoKind, setDemoKind] = useState('reward');
  const [demoPoll, setDemoPoll] = useState(true);
  const [saveState, setSaveState] = useState('saved'); // saved | saving | error
  const [listeners, setListeners] = useState(0);
  const saveTimer = useRef(null);
  const frameWrap = useRef(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    api.overlayConfig().then((c) => { setConfig(c); setListeners(c.listeners); }).catch((e) => setMsg({ type: 'error', text: e.message }));
    loadFiles();
    // cuántos overlays hay conectados (OBS, vista previa)
    const id = setInterval(() => api.overlayConfig().then((c) => setListeners(c.listeners)).catch(() => {}), 5000);
    return () => clearInterval(id);
  }, []);

  const loadFiles = () => api.overlayArchivos().then(setFiles).catch(() => {});

  // Vista previa: página de 1920×1080 escalada al ancho disponible
  useEffect(() => {
    const el = frameWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, [config === null]);

  // Cada cambio se guarda solo (con una pequeña espera) y el overlay lo aplica al momento
  const change = (patch) => {
    setConfig((c) => {
      const next = { ...c, ...patch };
      clearTimeout(saveTimer.current);
      setSaveState('saving');
      saveTimer.current = setTimeout(() => {
        api.guardarOverlay(next)
          .then(() => setSaveState('saved'))
          .catch((e) => { setSaveState('error'); setMsg({ type: 'error', text: e.message }); });
      }, 350);
      return next;
    });
  };
  const setColor = (kind, value) => change({ colors: { ...config.colors, [kind]: value } });
  const setMedia = (kind, field, value) => change({ media: { ...config.media, [kind]: { ...config.media[kind], [field]: value } } });

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 1800); } catch {
      setMsg({ type: 'warn', text: `No se pudo copiar automáticamente. Copia a mano: ${url}` });
    }
  };

  const upload = async (fileList) => {
    for (const f of fileList) {
      try { await api.subirArchivo(f); } catch (e) { setMsg({ type: 'error', text: `${f.name}: ${e.message}` }); }
    }
    loadFiles();
  };
  const removeFile = async (name) => {
    if (!confirm(`¿Eliminar "${name}"? Las alertas que lo usen volverán al ícono o tono por defecto.`)) return;
    try {
      await api.borrarArchivo(name);
      loadFiles();
      setConfig(await api.overlayConfig());
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  const playFile = (name) => {
    const a = new Audio(`/overlay/media/${encodeURIComponent(name)}`);
    a.volume = config?.volume ?? 0.5;
    a.play().catch(() => {});
  };

  if (!config) return <><h1>Overlay para OBS</h1>{msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}</>;

  const images = files.filter((f) => f.type === 'image');
  const sounds = files.filter((f) => f.type === 'sound');
  const previewUrl = `/overlay?preview=1&demo=${demoKind}${demoPoll ? '&demopoll=1' : '&widget=alertas'}`;

  return (
    <>
      <div className="section-head">
        <h1>Overlay para OBS</h1>
        <span className="muted small">
          <span className={`dot ${listeners > 0 ? 'ok' : 'off'} inline-dot`} />
          {listeners > 0 ? `${listeners} overlay${listeners === 1 ? '' : 's'} conectado${listeners === 1 ? '' : 's'}` : 'Ningún overlay conectado'}
        </span>
      </div>
      {msg && <div className={`banner ${msg.type}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      <details className="card obs-setup" open={listeners <= 1}>
        <summary><h3>Cómo agregarlo en OBS</h3></summary>
        <ol className="steps">
          <li>En tu escena, <strong>Fuentes → + → Navegador</strong>.</li>
          <li>Pega una de estas URLs, con <strong>ancho 1920</strong> y <strong>alto 1080</strong>.</li>
          <li>Marca <strong>"Controlar audio mediante OBS"</strong> para escuchar y ajustar el sonido de las alertas.</li>
          <li>Ponla <strong>encima</strong> de la captura del juego. El fondo es transparente.</li>
        </ol>
        <div className="overlay-urls">
          {URLS.map((u) => {
            const full = ORIGIN + u.path;
            return (
              <div key={u.id} className="overlay-url">
                <div><div className="overlay-url-label">{u.label}</div><div className="muted small">{u.hint}</div></div>
                <code>{full}</code>
                <button className="btn small" onClick={() => copy(full)}>{copied === full ? '✓ Copiada' : 'Copiar'}</button>
              </div>
            );
          })}
        </div>
      </details>

      <div className="appearance">
        <div className="appearance-controls">
      {/* ---------- Temas ---------- */}
      <div className="card">
        <div className="row between"><h3>Temas</h3><span className="muted small">Aplica un estilo completo y luego ajústalo a tu gusto</span></div>
        <div className="themes">
          {THEMES.map((t) => (
            <button key={t.id} className="theme" onClick={() => change(t.patch)}>
              <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[1]} 50%, ${t.swatch[0]} 50%)` }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Pestañas ---------- */}
      <div className="tabs">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      <div className="card tab-body">
        {tab === 'posicion' && (
          <div className="two-cols">
            <div>
              <h3>Alertas</h3>
              <PositionPicker value={config.position} onChange={(position) => change({ position })} />
              <Slider label="Tamaño" value={config.scale} min={0.4} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => change({ scale })} />
            </div>
            <div>
              <h3>Votación</h3>
              <PositionPicker value={config.pollPosition} onChange={(pollPosition) => change({ pollPosition })} />
              <Slider label="Tamaño" value={config.pollScale} min={0.4} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(pollScale) => change({ pollScale })} />
            </div>
            <div className="span-2">
              <h3>Separación de los bordes de la pantalla</h3>
              <div className="two-cols">
                <Slider label="Horizontal" value={config.marginX} min={0} max={600} step={10} format={(v) => `${v}px`} onChange={(marginX) => change({ marginX })} />
                <Slider label="Vertical" value={config.marginY} min={0} max={400} step={10} format={(v) => `${v}px`} onChange={(marginY) => change({ marginY })} />
              </div>
            </div>
          </div>
        )}

        {tab === 'animacion' && (
          <>
            <div className="field-row">
              <label className="field grow">
                <span>Entrada</span>
                <select value={config.animIn} onChange={(e) => change({ animIn: e.target.value })}>
                  {ANIM_IN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="field grow">
                <span>Salida</span>
                <select value={config.animOut} onChange={(e) => change({ animOut: e.target.value })}>
                  {ANIM_OUT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="two-cols">
              <Slider label="Velocidad de la animación" value={config.animSpeed} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(animSpeed) => change({ animSpeed })} />
              <Slider label="Tiempo en pantalla" value={config.durationSec} min={2} max={30} step={0.5} format={(v) => `${v}s`} onChange={(durationSec) => change({ durationSec })} />
            </div>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={config.shine} onChange={(e) => change({ shine: e.target.checked })} /> Destello al aparecer</label>
              <label className="check"><input type="checkbox" checked={config.iconMotion} onChange={(e) => change({ iconMotion: e.target.checked })} /> Mover el ícono (y temblor en el modo caos)</label>
              <label className="check"><input type="checkbox" checked={config.timerBar} onChange={(e) => change({ timerBar: e.target.checked })} /> Barra de tiempo restante</label>
              <label className="check"><input type="checkbox" checked={config.autoAlerts} onChange={(e) => change({ autoAlerts: e.target.checked })} /> Alerta automática al ejecutarse cualquier regla</label>
            </div>
          </>
        )}

        {tab === 'estilo' && (
          <>
            <div className="field-row">
              <label className="field grow">
                <span>Tipografía</span>
                <select value={config.font} onChange={(e) => change({ font: e.target.value })}>
                  {FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Color del texto</span>
                <input type="color" className="color-input" value={config.textColor} onChange={(e) => change({ textColor: e.target.value })} />
              </label>
            </div>
            <Slider label="Tamaño del texto" value={config.textScale} min={0.5} max={1.8} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(textScale) => change({ textScale })} />
            <label className="check"><input type="checkbox" checked={config.titleAccent} onChange={(e) => change({ titleAccent: e.target.checked })} /> El nombre (texto grande) usa el color del tipo de alerta</label>

            <h3 className="mt">Colores por tipo de alerta</h3>
            <div className="kind-colors">
              {KINDS.map((k) => (
                <label key={k.id} className="kind-color">
                  <input type="color" className="color-input" value={config.colors[k.id]} onChange={(e) => setColor(k.id, e.target.value)} />
                  <span>{k.icon} {k.label}</span>
                </label>
              ))}
            </div>

            <h3 className="mt">Fondo y borde</h3>
            <div className="segmented wide">
              {[['gradient', 'Degradado'], ['solid', 'Sólido'], ['none', 'Sin fondo (solo texto)']].map(([v, l]) => (
                <button key={v} className={config.bgStyle === v ? 'active' : ''} onClick={() => change({ bgStyle: v })}>{l}</button>
              ))}
            </div>
            {config.bgStyle !== 'none' && (
              <>
                <div className="field-row">
                  <label className="field"><span>{config.bgStyle === 'gradient' ? 'Color 1' : 'Color'}</span>
                    <input type="color" className="color-input" value={config.bgColor} onChange={(e) => change({ bgColor: e.target.value })} /></label>
                  {config.bgStyle === 'gradient' && (
                    <label className="field"><span>Color 2</span>
                      <input type="color" className="color-input" value={config.bgColor2} onChange={(e) => change({ bgColor2: e.target.value })} /></label>
                  )}
                  <div className="field grow">
                    <Slider label="Opacidad del fondo" value={config.bgOpacity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(bgOpacity) => change({ bgOpacity })} />
                  </div>
                </div>
                <div className="two-cols">
                  <Slider label="Grosor del borde" value={config.borderWidth} min={0} max={12} step={1} format={(v) => `${v}px`} onChange={(borderWidth) => change({ borderWidth })} />
                  <Slider label="Esquinas redondeadas" value={config.radius} min={0} max={60} step={1} format={(v) => `${v}px`} onChange={(radius) => change({ radius })} />
                </div>
                <label className="check"><input type="checkbox" checked={config.glow} onChange={(e) => change({ glow: e.target.checked })} /> Resplandor del color alrededor</label>
              </>
            )}
          </>
        )}

        {tab === 'medios' && (
          <>
            <div className="upload-zone"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('over')}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); upload(e.dataTransfer.files); }}>
              <div>Arrastra aquí tus imágenes, GIF o sonidos</div>
              <div className="muted small">PNG, JPG, GIF, WEBP · MP3, OGG, WAV · hasta 20 MB</div>
              <label className="btn small">
                Elegir archivos
                <input type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.mp3,.ogg,.wav" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
              </label>
            </div>

            {files.length > 0 && (
              <div className="file-grid">
                {files.map((f) => (
                  <div key={f.name} className="file-item">
                    {f.type === 'image'
                      ? <img src={`/overlay/media/${encodeURIComponent(f.name)}`} alt="" />
                      : <button className="file-play" onClick={() => playFile(f.name)} title="Escuchar">▶</button>}
                    <div className="file-name" title={f.name}>{f.name}</div>
                    <div className="muted small">{(f.size / 1024 / 1024).toFixed(f.size > 1048576 ? 1 : 2)} MB</div>
                    <button className="icon-btn danger file-del" onClick={() => removeFile(f.name)} title="Eliminar">✕</button>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mt">Por tipo de alerta</h3>
            <table className="table media-table">
              <thead><tr><th>Tipo</th><th>Imagen (en lugar del ícono)</th><th>Sonido (en lugar del tono)</th><th /></tr></thead>
              <tbody>
                {KINDS.map((k) => (
                  <tr key={k.id}>
                    <td className="nowrap">{k.icon} {k.label}</td>
                    <td>
                      <select value={config.media[k.id]?.image ?? ''} onChange={(e) => setMedia(k.id, 'image', e.target.value)}>
                        <option value="">Ícono por defecto ({k.icon})</option>
                        {images.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={config.media[k.id]?.sound ?? ''} onChange={(e) => setMedia(k.id, 'sound', e.target.value)}>
                        <option value="">Tono por defecto</option>
                        {sounds.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                      </select>
                    </td>
                    <td><button className="btn small ghost" onClick={() => api.probarOverlay(k.id)} title="Manda una alerta de este tipo a OBS">Probar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Para una imagen o sonido en una sola regla, usa en su editor la acción <strong>Alerta en overlay</strong>.</p>

            <div className="field-row mt">
              <div className="field">
                <span>Tamaño de la imagen</span>
                <div className="segmented">
                  <button className={config.imageSize === 'icon' ? 'active' : ''} onClick={() => change({ imageSize: 'icon' })}>Como ícono</button>
                  <button className={config.imageSize === 'large' ? 'active' : ''} onClick={() => change({ imageSize: 'large' })}>Grande, arriba del texto</button>
                </div>
              </div>
              <label className="check align-end"><input type="checkbox" checked={config.sound} onChange={(e) => change({ sound: e.target.checked })} /> Sonido</label>
              <div className="field grow">
                <Slider label="Volumen" value={config.volume} min={0} max={1} step={0.05} disabled={!config.sound} format={(v) => `${Math.round(v * 100)}%`} onChange={(volume) => change({ volume })} />
              </div>
            </div>
            <p className="muted small">La vista previa de arriba no suena. Para escuchar, usa ▶ en tus sonidos o "Probar", que suena en OBS.</p>
          </>
        )}
      </div>
        </div>
        <aside className="appearance-preview">
      {/* ---------- Vista previa ---------- */}
      <div className="card preview-card">
        <div className="row between wrap gap">
          <div className="row gap wrap">
            <span className="muted small">Vista previa de:</span>
            <div className="segmented">
              {KINDS.map((k) => <button key={k.id} className={demoKind === k.id ? 'active' : ''} onClick={() => setDemoKind(k.id)} title={k.label}>{k.icon}</button>)}
            </div>
            <label className="check"><input type="checkbox" checked={demoPoll} onChange={(e) => setDemoPoll(e.target.checked)} /> Mostrar votación de muestra</label>
          </div>
          <div className="row gap">
            <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'Error al guardar' : '✓ Guardado y aplicado'}</span>
            <button className="btn small" onClick={() => api.probarOverlay(demoKind)} title="Manda una alerta real: también sale en OBS, con sonido">🔔 Probar en OBS</button>
          </div>
        </div>
        <div className="overlay-preview" ref={frameWrap} style={{ height: 1080 * scale }}>
          <iframe key={previewUrl} title="Vista previa del overlay" src={previewUrl} style={{ transform: `scale(${scale})` }} />
        </div>
      </div>

        </aside>
      </div>
    </>
  );
}

function PositionPicker({ value, onChange }) {
  return (
    <div className="pos-picker">
      {POSITIONS.flat().map((p, i) => (
        p ? <button key={p} className={value === p ? 'active' : ''} onClick={() => onChange(p)} title={POSITION_LABELS[p]}><span /></button>
          : <span key={i} className="pos-empty" />
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange, disabled }) {
  return (
    <label className={`slider ${disabled ? 'disabled' : ''}`}>
      <span className="slider-head"><span>{label}</span><strong>{format(Number(value))}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
