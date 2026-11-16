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
  version: () => request('GET', '/api/app/version'),
  buscarActualizacion: () => request('POST', '/api/app/buscar-actualizacion'),
  actualizar: () => request('POST', '/api/app/actualizar'),
  pausa: () => request('POST', '/api/pausa'),
  reanudar: () => request('POST', '/api/reanudar'),
  reglas: () => request('GET', '/api/reglas'),
  guardarReglas: (data) => request('PUT', '/api/reglas', data),
  simular: (event) => request('POST', '/api/simular', event),
  conectarMinecraft: () => request('POST', '/api/minecraft/conectar'),
  comandoMinecraft: (command) => request('POST', '/api/minecraft/comando', { command }),
  recompensas: () => request('GET', '/api/twitch/recompensas'),
  canjes: () => request('GET', '/api/canjes'),
  resolverCanje: (id, action) => request('POST', `/api/canjes/${encodeURIComponent(id)}/${action}`),
  crearRecompensa: (data) => request('POST', '/api/twitch/recompensas', data),
  actualizarRecompensa: (id, patch) => request('PATCH', `/api/twitch/recompensas/${id}`, patch),
  eliminarRecompensa: (id) => request('DELETE', `/api/twitch/recompensas/${id}`),
  enviarChat: (text, replyTo) => request('POST', '/api/chat/enviar', { text, replyTo }),
  borrarMensaje: (id) => request('DELETE', `/api/chat/mensajes/${id}`),
  timeout: (user, seconds) => request('POST', '/api/chat/timeout', { userId: user.id, userName: user.displayName, seconds }),
  ban: (user) => request('POST', '/api/chat/ban', { userId: user.id, userName: user.displayName }),
  unban: (user) => request('POST', '/api/chat/unban', { userId: user.id, userName: user.displayName }),
  juego: () => request('GET', '/api/juego'),
  guardarVotaciones: (polls) => request('PUT', '/api/juego/votaciones', { polls }),
  guardarCaos: (chaos) => request('PUT', '/api/juego/caos', chaos),
  votacion: () => request('GET', '/api/votacion'),
  iniciarVotacion: (poll) => request('POST', '/api/votacion/iniciar', poll),
  terminarVotacion: () => request('POST', '/api/votacion/terminar'),
  cancelarVotacion: () => request('POST', '/api/votacion/cancelar'),
  votar: (option, user) => request('POST', '/api/votacion/votar', { option, user }),
  caos: () => request('GET', '/api/caos'),
  iniciarCaos: () => request('POST', '/api/caos/iniciar'),
  detenerCaos: () => request('POST', '/api/caos/detener'),
  caosAhora: () => request('POST', '/api/caos/ahora'),
  overlayConfig: () => request('GET', '/api/overlay/config'),
  guardarOverlay: (config) => request('PUT', '/api/overlay/config', config),
  probarOverlay: (kind) => request('POST', '/api/overlay/prueba', { kind }),
  overlayArchivos: () => request('GET', '/api/overlay/archivos'),
  borrarArchivo: (name) => request('DELETE', `/api/overlay/archivos/${encodeURIComponent(name)}`),
  subirArchivo: async (file) => {
    const res = await fetch(`/api/overlay/archivos?nombre=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    return data;
  },
  donaciones: () => request('GET', '/api/donaciones'),
  guardarDonacion: (id, patch) => request('PUT', `/api/donaciones/${id}`, patch),
  probarDonacion: (id, data) => request('POST', `/api/donaciones/${id}/prueba`, data),
  servidor: () => request('GET', '/api/servidor'),
  jugadoresChat: () => request('GET', '/api/jugadores-chat'),
  guardarJugadoresChat: (patch) => request('PUT', '/api/jugadores-chat', patch),
  gamerules: () => request('GET', '/api/gamerules'),
  catalogoGamerules: () => request('GET', '/api/gamerules/catalogo'),
  terminarGamerule: (id) => request('POST', '/api/gamerules/terminar', { id }),
  temporalesGamerules: () => request('GET', '/api/gamerules/temporales'),
  cambiarGamerule: (id, value) => request('POST', '/api/gamerules', { id, value }),
  estadisticas: ({ tests, ...q }) => request('GET', `/api/estadisticas?${new URLSearchParams({ ...q, tests: tests ? '1' : '0' })}`),
  respaldos: () => request('GET', '/api/respaldos'),
  respaldarAhora: () => request('POST', '/api/respaldos/ahora'),
  restaurarRespaldo: (file) => request('POST', '/api/respaldos/restaurar', { file }),
  borrarRespaldo: (file) => request('DELETE', `/api/respaldos/${encodeURIComponent(file)}`),
  ajustesRespaldos: (patch) => request('PUT', '/api/respaldos/ajustes', patch),
  abrirCarpetaRespaldos: () => request('POST', '/api/respaldos/abrir-carpeta'),
  elegirCarpetaRespaldos: () => request('POST', '/api/respaldos/elegir-carpeta'),
  instalaciones: () => request('GET', '/api/instalaciones'),
  javas: () => request('GET', '/api/instalaciones/java'),
  versionJava: (java) => request('POST', '/api/instalaciones/java/version', { java }),
  revisarInstalacion: (dir) => request('POST', '/api/instalaciones/revisar', { dir }),
  elegirCarpeta: () => request('POST', '/api/instalaciones/elegir-carpeta'),
  agregarInstalacion: (body) => request('POST', '/api/instalaciones', body),
  editarInstalacion: (id, body) => request('PUT', `/api/instalaciones/${encodeURIComponent(id)}`, body),
  quitarInstalacion: (id) => request('DELETE', `/api/instalaciones/${encodeURIComponent(id)}`),
  paperInfo: (id, force = false) => request('GET', `/api/instalaciones/${encodeURIComponent(id)}/paper${force ? '?forzar=1' : ''}`),
  paperEstado: (id) => request('GET', `/api/instalaciones/${encodeURIComponent(id)}/paper/estado`),
  actualizarPaper: (id) => request('POST', `/api/instalaciones/${encodeURIComponent(id)}/paper/actualizar`),
  revertirPaper: (id) => request('POST', `/api/instalaciones/${encodeURIComponent(id)}/paper/revertir`),
  activarInstalacion: (id, start = false) => request('POST', `/api/instalaciones/${encodeURIComponent(id)}/activar`, { start }),
  servidorRed: () => request('GET', '/api/servidor/red'),
  direccionPublica: (address) => request('POST', '/api/servidor/direccion-publica', { address }),
  jugadores: () => request('GET', '/api/servidor/jugadores'),
  expulsar: (name, reason) => request('POST', '/api/servidor/jugadores/expulsar', { name, reason }),
  whitelist: () => request('GET', '/api/servidor/whitelist'),
  whitelistAccion: (action, name) => request('POST', '/api/servidor/whitelist', { action, name }),
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
