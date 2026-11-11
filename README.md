# stream-interact

Permite que el chat de tus directos interactúe con tu juego. Primera versión: **Twitch → Minecraft (Java)**.

```
Twitch (EventSub WebSocket) ─┐
(luego Kick / YouTube)       ├─► EventBus (cola + pausa) ─► RulesEngine (config/rules.json) ─► Acciones
Simulador (/simular)        ─┘                                                              ├─ minecraft (RCON)
                                                                                            ├─ chat
                                                                                            └─ wait
```

## 1. Preparar Minecraft (servidor local con RCON)

RCON es la forma en que la app manda comandos a Minecraft (`/summon`, `/give`, `/weather`…).
Solo funciona con un **servidor**, así que juegas conectándote a tu propio servidor local:

1. Descarga [Paper](https://papermc.io/downloads/paper) (o el `server.jar` vanilla) de la misma versión que tu cliente de Minecraft.
2. Ponlo en una carpeta aparte (por ejemplo `C:\Users\vitro\dev\mc-server`) y ejecútalo una vez: `java -jar paper.jar nogui`.
3. Acepta el EULA (`eula=true` en `eula.txt`).
4. En `server.properties` cambia:
   ```properties
   enable-rcon=true
   rcon.port=25575
   rcon.password=una_contraseña_larga
   ```
5. Vuelve a iniciar el servidor y en Minecraft conéctate a `localhost`.

> No abras el puerto 25575 en tu router: RCON solo debe usarse desde tu PC.

## 2. Configurar la app

```bash
npm install
copy .env.example .env    # en Windows (en Mac/Linux: cp)
```

Llena `.env` con:
- tu `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET`;
- la `MC_RCON_PASSWORD` que pusiste en `server.properties`;
- tu nombre de jugador en `MC_PLAYER`.

## 3. Arrancar

```bash
npm start
```

La primera vez, abre **http://localhost:3000/auth/login** e inicia sesión con tu cuenta de Twitch.
El token se guarda en `data/` (ignorado por Git) y se renueva solo.

## 4. Probar sin estar en directo

Con la app corriendo, en otra terminal:

```bash
npm run simular -- reward "Invocar zombie" Pepe
npm run simular -- command !lluvia Pepe
npm run simular -- cheer bits Pepe 500
```

## 5. Reglas (`config/rules.json`)

Cada regla tiene un **trigger** (cuándo se activa) y una lista de **acciones** (qué pasa). El archivo se recarga solo al guardarlo.

```json
{
  "id": "zombie",
  "trigger": { "type": "reward", "name": "Invocar zombie" },
  "cooldownMs": 10000,
  "userCooldownMs": 30000,
  "actions": [
    { "type": "minecraft", "commands": ["execute at {player} run summon minecraft:zombie ~3 ~ ~3"] },
    { "type": "chat", "message": "🧟 {user} invocó un zombie" }
  ]
}
```

- **Tipos de trigger:**
  - `reward`: recompensa; `name` es el título exacto, sin importar mayúsculas.
  - `command`: comando del chat, por ejemplo `!lluvia`.
  - `cheer`: bits; se filtra con `minAmount` / `maxAmount`.
- **Variables:** `{player}`, `{user}`, `{input}` (texto del usuario, ya limpio), `{amount}` y `{platform}`.
- **Orden:** se usa la **primera** regla que coincida. Por eso las de bits van de mayor a menor.
- **Acciones:**
  - `minecraft`: comandos sin la `/`.
  - `announce`: mensaje con color en el chat de Minecraft, con etiqueta de la plataforma y sin emojis. Ejemplo: `{"type":"announce","text":"{user} te mandó un zombie","color":"green"}`.
  - `title`: texto grande en tu pantalla. Ejemplo: `{"type":"title","title":"¡Cuidado!","subtitle":"{user} te mandó algo","color":"red"}`.
  - `chat`: responde en el chat de Twitch (aquí sí funcionan los emojis).
  - `wait`: pausa, con `{"type":"wait","ms":2000}`.
- **Ajustes (`settings`):**
  - `cooldownReplies`: avisa en el chat cuando algo está en cooldown, una sola vez por usuario.
  - `helpCommand`: nombre del comando que lista los comandos disponibles (por defecto `!comandos`).
- **Desactivar una regla:** agrégale `"enabled": false`.

**Las recompensas tienen que existir en Twitch** con el mismo título que pongas en la regla. Puedes crearlas desde el panel de Twitch, como siempre.

Si prefieres que la app las cree, hay una ventaja: Twitch solo deja que una app complete o reembolse los canjes de las recompensas que ella misma creó. Así, cuando una regla esté en cooldown, la app devolverá los puntos automáticamente. Para crearlas desde la app:

```bash
curl -X POST http://localhost:3000/twitch/recompensas -H "Content-Type: application/json" -d "{\"title\":\"Invocar zombie\",\"cost\":500}"
```

> Los puntos de canal solo existen si tu canal es afiliado o partner.

## 6. Botón de pánico

- **En el chat (tú o tus mods):** `!pausa` y `!reanudar`.
- **En el navegador:** http://localhost:3000/pausa y http://localhost:3000/reanudar.
- **Estado:** http://localhost:3000/estado.

Al pausar se descartan las acciones pendientes de la cola.

## Estructura

```
src/
  index.js              arranque
  config.js             lee .env
  server.js             panel local y endpoints de control
  auth/twitchAuth.js    login OAuth con Twitch y renovación del token
  adapters/twitch.js    EventSub → eventos normalizados
  core/eventBus.js      cola, pausa y despacho de eventos
  core/rulesEngine.js   coincidencia de reglas, cooldowns y variables
  actions/minecraft.js  RCON con reconexión automática
  actions/chat.js       respuestas en el chat
config/rules.json       tus reglas
scripts/simular.js      simulador de eventos
```

Para agregar otra plataforma, crea `src/adapters/kick.js` que llame a `bus.emit({...})` con el mismo formato que usa `twitch.js`.
