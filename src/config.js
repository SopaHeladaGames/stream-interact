import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable ${name} en tu archivo .env (revisa .env.example)`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  twitch: {
    clientId: required('TWITCH_CLIENT_ID'),
    clientSecret: required('TWITCH_CLIENT_SECRET'),
    redirectUri: process.env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
    // Permisos que pedimos al iniciar sesión con Twitch
    scopes: [
      'channel:read:redemptions',
      'channel:manage:redemptions', // marcar canjes como completados / reembolsar
      'user:read:chat',             // leer el chat (comandos)
      'user:write:chat',            // responder en el chat
      'bits:read',                  // cheers
      'moderator:manage:chat_messages', // borrar mensajes desde el panel
      'moderator:manage:banned_users',  // timeout / ban desde el panel
      'channel:read:subscriptions',     // suscripciones y subs regaladas
      'moderator:read:followers'        // follows
    ]
  },
  minecraft: {
    host: process.env.MC_RCON_HOST ?? '127.0.0.1',
    port: Number(process.env.MC_RCON_PORT ?? 25575),
    password: required('MC_RCON_PASSWORD'),
    player: required('MC_PLAYER')
  },
  // Servidor de Minecraft controlado por la app (opcional)
  mcServer: {
    dir: process.env.MC_SERVER_DIR || null,
    java: process.env.MC_JAVA || 'java',
    memoryMin: process.env.MC_MEMORY_MIN || '2G',
    memoryMax: process.env.MC_MEMORY_MAX || '4G',
    autoRestart: (process.env.MC_AUTO_RESTART ?? 'true') === 'true',
    autoStart: (process.env.MC_SERVER_AUTOSTART ?? 'false') === 'true'
  },
  // Abrir el cliente de Playit.gg junto con la app (opcional)
  playit: {
    enabled: (process.env.PLAYIT_AUTOSTART ?? 'false') === 'true',
    customPath: process.env.PLAYIT_PATH || null
  },
  chatReplies: (process.env.CHAT_REPLIES ?? 'true') === 'true'
};
