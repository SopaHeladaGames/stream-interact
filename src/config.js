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
      'bits:read'                   // cheers
    ]
  },
  minecraft: {
    host: process.env.MC_RCON_HOST ?? '127.0.0.1',
    port: Number(process.env.MC_RCON_PORT ?? 25575),
    password: required('MC_RCON_PASSWORD'),
    player: required('MC_PLAYER')
  },
  chatReplies: (process.env.CHAT_REPLIES ?? 'true') === 'true'
};
