// Cliente de la API del backend. Rutas relativas: funcionan servido por Express, con el proxy de Vite y en Electron.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

export const api = {
  estado: () => request('GET', '/api/estado'),
  pausa: () => request('POST', '/api/pausa'),
  reanudar: () => request('POST', '/api/reanudar'),
  reglas: () => request('GET', '/api/reglas'),
  guardarReglas: (data) => request('PUT', '/api/reglas', data),
  simular: (event) => request('POST', '/api/simular', event),
  conectarMinecraft: () => request('POST', '/api/minecraft/conectar'),
  comandoMinecraft: (command) => request('POST', '/api/minecraft/comando', { command }),
  recompensas: () => request('GET', '/api/twitch/recompensas'),
  crearRecompensa: (data) => request('POST', '/api/twitch/recompensas', data),
  actualizarRecompensa: (id, patch) => request('PATCH', `/api/twitch/recompensas/${id}`, patch),
  eliminarRecompensa: (id) => request('DELETE', `/api/twitch/recompensas/${id}`),
  enviarChat: (text, replyTo) => request('POST', '/api/chat/enviar', { text, replyTo }),
  borrarMensaje: (id) => request('DELETE', `/api/chat/mensajes/${id}`),
  timeout: (user, seconds) => request('POST', '/api/chat/timeout', { userId: user.id, userName: user.displayName, seconds }),
  ban: (user) => request('POST', '/api/chat/ban', { userId: user.id, userName: user.displayName }),
  unban: (user) => request('POST', '/api/chat/unban', { userId: user.id, userName: user.displayName }),
  servidor: () => request('GET', '/api/servidor'),
  iniciarServidor: () => request('POST', '/api/servidor/iniciar'),
  detenerServidor: () => request('POST', '/api/servidor/detener'),
  reiniciarServidor: () => request('POST', '/api/servidor/reiniciar'),
  comandoServidor: (command) => request('POST', '/api/servidor/comando', { command })
};

/** Se suscribe al feed en vivo. Devuelve una función para cerrar la conexión. */
export function subscribeFeed(onEntry) {
  const source = new EventSource('/api/feed');
  source.onmessage = (e) => onEntry(JSON.parse(e.data));
  return () => source.close();
}

/** Consola del servidor de Minecraft en vivo. */
export function subscribeConsole(onLine) {
  const source = new EventSource('/api/servidor/consola');
  source.onmessage = (e) => onLine(JSON.parse(e.data));
  return () => source.close();
}

/** Chat de Twitch en vivo (mensajes, canjes, bits y borrados). */
export function subscribeChat(onEntry) {
  const source = new EventSource('/api/chat/feed');
  source.onmessage = (e) => onEntry(JSON.parse(e.data));
  return () => source.close();
}
