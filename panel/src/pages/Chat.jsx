import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, subscribeChat } from '../api.js';
import { ChatRewardList, ChatRedemptions } from '../components/ChatRewards.jsx';

const MAX_MESSAGES = 300;
const FALLBACK_COLORS = ['#FF4A80', '#FF7F50', '#1E90FF', '#2E8B57', '#DAA520', '#9ACD32', '#00C7AC', '#B87CFF', '#FF69B4', '#5F9EA0'];
const BADGES = {
  broadcaster: { label: 'Streamer', icon: '◉', className: 'bd-broadcaster' },
  moderator: { label: 'Moderador', icon: '⚔', className: 'bd-mod' },
  vip: { label: 'VIP', icon: '◆', className: 'bd-vip' },
  subscriber: { label: 'Suscriptor', icon: '★', className: 'bd-sub' },
  founder: { label: 'Fundador', icon: '★', className: 'bd-sub' },
  partner: { label: 'Partner', icon: '✔', className: 'bd-partner' }
};

const DONATION_SOURCES = { streamlabs: 'Streamlabs', streamelements: 'StreamElements', kofi: 'Ko-fi' };

const nameColor = (user) => {
  if (user?.color) return user.color;
  const name = user?.name ?? '';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
};

const emoteUrl = (part) =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${part.id}/${part.animated ? 'animated' : 'static'}/dark/2.0`;

/**
 * Chat de Twitch en la columna derecha de la app: siempre visible en todas las secciones.
 */
export default function ChatPanel({ conectado, canal, loginUrl, onClose, top }) {
  const [entries, setEntries] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [pinned, setPinned] = useState(true);   // seguir el final del chat
  const [unseen, setUnseen] = useState(0);
  const [showEvents, setShowEvents] = useState(true);
  const [showTimes, setShowTimes] = useState(false);
  const [tab, setTab] = useState('chat'); // chat | recompensas | canjes
  const [pending, setPending] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pinnedRef = useRef(true);

  // Recibir el chat en vivo
  useEffect(() => subscribeChat((entry) => {
    setEntries((prev) => {
      if (entry.kind === 'delete') return prev.map((m) => (m.kind === 'message' && m.id === entry.messageId ? { ...m, deleted: true } : m));
      if (entry.kind === 'clearUser') return prev.map((m) => (m.kind === 'message' && m.user?.id === entry.userId ? { ...m, deleted: true } : m));
      if (entry.kind === 'clear') return [...prev.map((m) => (m.kind === 'message' ? { ...m, deleted: true } : m)), { ...entry, kind: 'system', text: 'Se limpió el chat' }];
      if (prev.some((m) => m.seq === entry.seq)) return prev;
      return [...prev, entry].slice(-MAX_MESSAGES);
    });
    if ((entry.kind === 'message' || entry.kind === 'event') && !pinnedRef.current) setUnseen((n) => n + 1);
  }), []);

  // Mantener el scroll abajo mientras estés "pegado" al final
  useLayoutEffect(() => {
    if (pinned && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, pinned]);

  const onScroll = () => {
    const el = listRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
    if (atBottom) setUnseen(0);
  };
  const jumpToBottom = () => { pinnedRef.current = true; setPinned(true); setUnseen(0); };

  const flash = (msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(flash.t);
    flash.t = setTimeout(() => setToast(null), 3000);
  };

  const send = async (e) => {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.enviarChat(msg, replyTo?.id);
      setText('');
      setReplyTo(null);
      jumpToBottom();
    } catch (err) { flash(err.message, 'error'); } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const act = async (fn, okMsg) => {
    try { await fn(); if (okMsg) flash(okMsg); } catch (err) { flash(err.message, 'error'); }
  };

  const mention = (user) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${user.displayName} `);
    inputRef.current?.focus();
  };

  const startReply = (m) => { setReplyTo(m); inputRef.current?.focus(); };

  const visible = entries.filter((e) => showEvents || e.kind !== 'event');

  // Canjes pendientes (para el numerito de la pestaña, aunque no esté abierta)
  useEffect(() => {
    if (!conectado) return undefined;
    const load = () => api.canjes().then((d) => setPending(d.pending.length)).catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [conectado]);

  const tabs = (
    <div className="chat-tabs">
      <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
      <button className={tab === 'recompensas' ? 'active' : ''} onClick={() => setTab('recompensas')}>Recompensas</button>
      <button className={tab === 'canjes' ? 'active' : ''} onClick={() => setTab('canjes')}>
        Canjes{pending > 0 && <span className="tab-count">{pending}</span>}
      </button>
    </div>
  );

  const header = (
    <div className="chat-head">
      <div className="chat-head-title">
        <span className={`dot ${conectado ? 'ok' : 'off'}`} />
        <strong>Chat</strong>
        {canal && <span className="muted chat-channel">{canal}</span>}
      </div>
      <div className="chat-head-tools">
        <button className={`tool ${showEvents ? 'on' : ''}`} onClick={() => setShowEvents((v) => !v)} title={showEvents ? 'Ocultar canjes y bits' : 'Mostrar canjes y bits'}>🎁</button>
        <button className={`tool ${showTimes ? 'on' : ''}`} onClick={() => setShowTimes((v) => !v)} title={showTimes ? 'Ocultar hora' : 'Mostrar hora'}>🕒</button>
        <button className="tool" onClick={() => setEntries([])} title="Limpiar la vista (no borra nada en Twitch)">⌫</button>
        <button className="tool" onClick={onClose} title="Ocultar el chat">»</button>
      </div>
    </div>
  );

  if (!conectado) {
    return (
      <div className="chat-page">
        {header}
        {top}
        <div className="chat-box">
          <div className="empty">
            Conecta tu cuenta de Twitch para ver el chat.
            {loginUrl && <div style={{ marginTop: 12 }}><a className="btn small" href={loginUrl}>Conectar Twitch</a></div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      {header}
      {top}
      {tabs}
      {tab !== 'chat' && (
        <div className="chat-box side-box">
          {tab === 'recompensas' ? <ChatRewardList flash={flash} /> : <ChatRedemptions flash={flash} onCount={setPending} />}
          {toast && <div className={`chat-toast ${toast.type}`}>{toast.msg}</div>}
        </div>
      )}
      <div className="chat-box" style={tab === 'chat' ? undefined : { display: 'none' }}>
        <div className="chat-list" ref={listRef} onScroll={onScroll}>
          {visible.length === 0 && <div className="empty">Aún no hay mensajes. Escribe algo en tu chat o aquí abajo.</div>}
          {visible.map((e) => {
            if (e.kind === 'event') return <ChatEvent key={e.seq} e={e} showTime={showTimes} />;
            if (e.kind === 'system') return <div key={e.seq} className="chat-system">{e.text}</div>;
            return (
              <ChatMessage
                key={e.seq}
                m={e}
                showTime={showTimes}
                onReply={() => startReply(e)}
                onMention={() => mention(e.user)}
                onDelete={() => act(() => api.borrarMensaje(e.id))}
                onTimeout={(secs) => act(() => api.timeout(e.user, secs), `Timeout de ${secs >= 60 ? `${secs / 60} min` : `${secs}s`} a ${e.user.displayName}`)}
                onBan={() => confirm(`¿Banear a ${e.user.displayName} del canal?`) && act(() => api.ban(e.user), `${e.user.displayName} fue baneado`)}
                onUnban={() => act(() => api.unban(e.user), `Se quitó el ban/timeout a ${e.user.displayName}`)}
              />
            );
          })}
        </div>

        {!pinned && (
          <button className="chat-jump" onClick={jumpToBottom}>
            {unseen > 0 ? `${unseen} mensaje${unseen === 1 ? '' : 's'} nuevo${unseen === 1 ? '' : 's'} ↓` : 'Ir al final ↓'}
          </button>
        )}
        {toast && <div className={`chat-toast ${toast.type}`}>{toast.msg}</div>}

        <form className="chat-composer" onSubmit={send}>
          {replyTo && (
            <div className="reply-bar">
              <span>↪ Respondiendo a <strong style={{ color: nameColor(replyTo.user) }}>{replyTo.user.displayName}</strong>: <span className="muted">{replyTo.text.slice(0, 80)}</span></span>
              <button type="button" className="icon-btn" onClick={() => setReplyTo(null)} title="Cancelar respuesta">✕</button>
            </div>
          )}
          <div className="composer-row">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setReplyTo(null); }}
              placeholder="Enviar un mensaje como tú…"
              maxLength={500}
            />
            <span className={`char-count ${text.length > 450 ? 'warn' : ''}`}>{text.length > 400 ? 500 - text.length : ''}</span>
            <button className="btn primary" disabled={!text.trim() || sending}>{sending ? '…' : 'Enviar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChatMessage({ m, showTime, onReply, onMention, onDelete, onTimeout, onBan, onUnban }) {
  const isStreamer = m.user.badges?.includes('broadcaster');
  const classes = ['chat-msg', m.deleted && 'deleted', m.highlighted && 'highlighted', m.mentionsMe && 'mention', m.isCommand && 'command'].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {m.reply && (
        <div className="chat-reply">↪ {m.reply.user}: {m.reply.text?.slice(0, 90)}</div>
      )}
      <div className="chat-line">
        {showTime && <span className="chat-time">{new Date(m.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
        {m.user.badges?.filter((b) => BADGES[b]).map((b) => (
          <span key={b} className={`badge-icon ${BADGES[b].className}`} title={BADGES[b].label}>{BADGES[b].icon}</span>
        ))}
        <button className="chat-name" style={{ color: nameColor(m.user) }} onClick={onMention} title="Mencionar">{m.user.displayName}</button>
        <span className="chat-colon">:</span>
        <span className="chat-text">
          {m.deleted && <span className="deleted-label">(eliminado) </span>}
          {m.parts.map((p, i) => {
            if (p.type === 'emote') return <Emote key={i} part={p} />;
            if (p.type === 'mention') return <span key={i} className="chat-mention">{p.text}</span>;
            if (p.type === 'cheermote') return <span key={i} className="chat-cheer">{p.text}</span>;
            return <span key={i}>{p.text}</span>;
          })}
        </span>
      </div>

      <div className="chat-actions">
        <button onClick={onReply} title="Responder">↪</button>
        {!m.deleted && <button onClick={onDelete} title="Borrar mensaje">🗑</button>}
        {!isStreamer && (
          <>
            <button onClick={() => onTimeout(60)} title="Timeout 1 minuto">1m</button>
            <button onClick={() => onTimeout(600)} title="Timeout 10 minutos">10m</button>
            <button onClick={onBan} className="danger" title="Banear">⛔</button>
            <button onClick={onUnban} title="Quitar ban o timeout">↺</button>
          </>
        )}
      </div>
    </div>
  );
}

function ChatEvent({ e, showTime }) {
  const name = e.user?.displayName ?? 'Alguien';
  return (
    <div className={`chat-event ev-${e.eventType}`}>
      {showTime && <span className="chat-time">{new Date(e.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
      {e.eventType === 'reward' ? (
        <span>🎁 <strong>{name}</strong> canjeó <strong>{e.title}</strong> <span className="muted">({e.amount.toLocaleString('es-MX')})</span></span>
      ) : e.eventType === 'donation' ? (
        <span>💵 <strong>{name}</strong> donó <strong>{e.money}</strong> <span className="muted">· {DONATION_SOURCES[e.platform] ?? e.platform}{e.isTest ? ' · prueba' : ''}</span></span>
      ) : e.eventType === 'sub' ? (
        <span>⭐ <strong>{name}</strong> {e.resub ? <>se resuscribió · <strong>{e.amount} meses</strong></> : 'se suscribió'}{e.tier && e.tier !== '1' ? <span className="muted"> · Tier {e.tier}</span> : null}</span>
      ) : e.eventType === 'gift' ? (
        <span>🎁 <strong>{name}</strong> regaló <strong>{e.amount} {e.amount === 1 ? 'sub' : 'subs'}</strong>{e.tier && e.tier !== '1' ? <span className="muted"> · Tier {e.tier}</span> : null}</span>
      ) : e.eventType === 'raid' ? (
        <span>🚀 <strong>{name}</strong> llegó con una raid de <strong>{e.amount} viewers</strong></span>
      ) : e.eventType === 'follow' ? (
        <span>❤️ <strong>{name}</strong> ahora te sigue</span>
      ) : (
        <span>💎 <strong>{name}</strong> mandó <strong>{e.amount.toLocaleString('es-MX')} bits</strong></span>
      )}
      {e.input && <div className="chat-event-input">“{e.input}”</div>}
    </div>
  );
}

/** Emote de Twitch; si la imagen no carga, muestra su nombre como texto. */
function Emote({ part }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="emote-text">{part.text}</span>;
  return <img className="emote" src={emoteUrl(part)} alt={part.text} title={part.text} onError={() => setFailed(true)} />;
}
