import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { RefreshingAuthProvider, exchangeCode } from '@twurple/auth';
import { log } from '../core/logger.js';

const TOKEN_FILE = path.resolve('data', 'twitch-token.json');

async function readToken() {
  try {
    return JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function saveToken(token) {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
}

/**
 * Crea el AuthProvider de Twitch. Si no hay token guardado, registra las rutas
 * /auth/login y /auth/callback en el servidor Express y espera a que inicies sesión.
 * Devuelve { authProvider, userId }.
 */
export async function createTwitchAuth(app, { clientId, clientSecret, redirectUri, scopes }, port) {
  const authProvider = new RefreshingAuthProvider({ clientId, clientSecret });
  authProvider.onRefresh(async (_userId, newToken) => saveToken(newToken));

  // Siempre registramos las rutas para poder volver a iniciar sesión si cambian los permisos
  let resolveLogin;
  const loginDone = new Promise((resolve) => { resolveLogin = resolve; });
  const pendingStates = new Set();

  app.get('/auth/login', (_req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('force_verify', 'true');
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Twitch devolvió un error: ${error}`);
    if (!state || !pendingStates.delete(state)) return res.status(400).send('State inválido, vuelve a /auth/login');
    try {
      const token = await exchangeCode(clientId, clientSecret, code, redirectUri);
      await saveToken(token);
      res.send('<h2>¡Listo! Ya puedes cerrar esta pestaña y volver a la terminal.</h2>');
      resolveLogin(token);
    } catch (err) {
      log.error('Error al intercambiar el código de Twitch:', err.message);
      res.status(500).send('No se pudo completar el login. Revisa la terminal.');
    }
  });

  let token = await readToken();
  const missingScopes = token ? scopes.filter((s) => !(token.scope ?? []).includes(s)) : scopes;
  if (!token || missingScopes.length) {
    if (token) log.warn('Al token guardado le faltan permisos:', missingScopes.join(', '));
    log.info(`👉 Abre http://localhost:${port}/auth/login en tu navegador para conectar tu cuenta de Twitch`);
    token = await loginDone;
  }

  const userId = await authProvider.addUserForToken(token, ['chat']);
  return { authProvider, userId };
}
