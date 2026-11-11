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
  crearRecompensa: (data) => request('POST', '/api/twitch/recompensas', data)
};

/** Se suscribe al feed en vivo. Devuelve una función para cerrar la conexión. */
export function subscribeFeed(onEntry) {
  const source = new EventSource('/api/feed');
  source.onmessage = (e) => onEntry(JSON.parse(e.data));
  return () => source.close();
}
