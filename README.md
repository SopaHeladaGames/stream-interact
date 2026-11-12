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

## Panel de control

Un panel en React para ver la actividad en vivo, editar reglas sin tocar el JSON, probar eventos y administrar recompensas.

**Instalación (solo la primera vez):**
```bash
npm run panel:install
npm run panel:build
```
Después de compilarlo, `npm start` lo sirve en **http://localhost:3000**. Vuelve a ejecutar `npm run panel:build` cada vez que cambie el código del panel.

**Para trabajar en el panel**, con recarga en caliente, usa dos terminales:
```bash
npm start            # backend en :3000
npm run panel:dev    # panel en http://localhost:5173 (redirige /api al backend)
```

**Secciones:**
- **Inicio:** estado de Twitch, Minecraft y la cola, más la actividad en vivo.
- **Reglas:** editor con formulario. Se valida al guardar y se aplica al instante.
- **Probar:** un botón por regla, eventos personalizados y comandos directos a Minecraft.
- **Recompensas:** recompensas de tu canal y si tienen regla asignada. Desde aquí también puedes crear recompensas propias de la app (con reembolso automático).

El botón **Pausar todo** de la barra lateral equivale a `!pausa`.

## App de escritorio (Electron)

En lugar de `npm start` y el navegador, puedes abrir todo como un programa:

```bash
npm install          # solo la primera vez, instala Electron
npm run panel:build  # si no lo has compilado
npm run desktop
```

O haz **doble clic en `iniciar.vbs`**, que abre la app sin dejar una terminal abierta.

**Qué incluye:**
- **Ventana propia:** al cerrarla, la app sigue funcionando en la **bandeja del sistema**, junto al reloj. Para salir del todo: clic derecho en el ícono → *Salir*.
- **Atajo global de pánico** (`Ctrl+Shift+P`): pausa o reanuda las interacciones aunque estés dentro de Minecraft, con una notificación de Windows. Se cambia con `PANIC_SHORTCUT` en el `.env`.
- **Ícono de la bandeja en rojo** mientras está en pausa, con un menú rápido para pausar y para iniciar o detener el servidor.
- **Notificación** si el servidor de Minecraft se cae.
- **El login de Twitch** se abre en tu navegador normal.
- **Ctrl+R o F5** recargan el panel (por ejemplo, después de `npm run panel:build`). También puedes usar *Recargar panel* en el menú de la bandeja.
- **Al salir**, apaga el servidor de Minecraft guardando el mundo.

**Para desarrollar el panel con recarga en caliente** dentro de la app: ejecuta `npm run panel:dev` en una terminal y `npm run desktop:dev` en otra.

## Chat de Twitch en el panel

El chat está **siempre visible en la columna derecha** de la app, en todas las secciones. Muestra los mensajes en vivo con emotes, colores e insignias, y los canjes de recompensas y los bits aparecen ahí mismo.

- **Ancho:** arrastra su borde izquierdo (doble clic vuelve al tamaño normal).
- **Ocultar:** con **»**; vuelve con la pestaña *Chat* del borde derecho. La app recuerda el ancho y si lo dejaste oculto.
- **Barra superior:** 🎁 muestra u oculta canjes y bits, 🕒 muestra la hora y ⌫ limpia la vista (no borra nada en Twitch).
- **Ventana angosta:** el chat se muestra encima del contenido para no apretarlo.

- **Escribir:** desde la caja de abajo. Los mensajes salen con tu cuenta.
- **Responder:** con ↪ al pasar el mouse sobre un mensaje. *Esc* cancela la respuesta.
- **Mencionar:** clic en un nombre para agregar `@nombre` a tu mensaje.
- **Moderar** (al pasar el mouse):
  - 🗑 borrar el mensaje;
  - **1m / 10m**: timeout;
  - ⛔ ban, con confirmación;
  - ↺ quitar el ban o el timeout.
- **Sincronización:** si un mod borra mensajes o limpia el chat desde Twitch, también se ve en la app.
- **Resaltado:** las menciones a ti salen en rojo y los mensajes destacados con puntos, en morado.

La moderación necesita permisos extra de Twitch (`moderator:manage:chat_messages` y `moderator:manage:banned_users`). La primera vez que abras esta versión, la app te pedirá iniciar sesión de nuevo.

## Votaciones del chat

En la página **Votaciones** creas preguntas con 2 a 5 opciones. Cada opción apunta a una de tus reglas: la que gane, se ejecuta.

- **Votar:** el chat escribe el número de la opción (`1`, `2`… o `!1`, `!2`…). Cada persona tiene un voto y puede cambiarlo.
- **Lanzar:** con **▶ Iniciar votación** en el panel, o desde el chat (tú y tus mods) con `!votacion` (la primera guardada) o `!votacion nombre`. `!votacion cancelar` la cancela.
- **En vivo:** el conteo y el tiempo restante se ven arriba del chat, en la columna derecha. Al terminar, el resultado se queda unos segundos.
- **Empates:** gana una de las empatadas al azar. Si nadie vota, eliges si no pasa nada o gana una al azar.
- **Avisos:** la app anuncia el inicio y el resultado en el chat de Twitch y dentro de Minecraft.
- **Probar sin espectadores:** en la página, los botones **+1** simulan votos.

En las reglas, `{user}` vale "El chat" cuando se ejecutan por una votación.

## Modo caos

En la página **Modo caos** marcas qué reglas pueden salir y cada cuánto (un tiempo al azar entre el mínimo y el máximo). Mientras esté activo, la app ejecuta una de esas reglas al azar en cada turno, sin repetir la misma dos veces seguidas.

- **Encender y apagar:** desde el panel, o con `!caos` en el chat (tú y tus mods). Siempre arranca apagado al abrir la app.
- **⚡ Lanzar uno ahora:** ejecuta un evento al momento, esté o no encendido.
- **Pausa:** con las interacciones en pausa, o sin conexión a Minecraft, los turnos se saltan.

En las reglas, `{user}` vale "El modo caos".

Las votaciones y la configuración del modo caos se guardan en `config/juego.json`. Ni las votaciones ni el modo caos revisan los cooldowns de las reglas.

## Servidor de Minecraft desde la app

Agrega a tu `.env`:
```env
MC_SERVER_DIR=C:\Users\vitro\dev\mc-server
```
Con eso, en la página **Servidor** del panel puedes:
- iniciarlo, detenerlo y reiniciarlo;
- ver la consola en vivo y escribir comandos (con ↑ y ↓ recorres los anteriores).

Si se cae, se reinicia solo en 10 segundos. Para evitar un ciclo de reinicios, se detiene después de 3 caídas en 5 minutos.

Con `MC_SERVER_AUTOSTART=true`, el servidor arranca junto con la app.

> Si el servidor ya está corriendo con `start.bat`, la app lo detecta como "fuera de la app": puede mandarle comandos por RCON, pero no ver su consola. Para controlarlo desde el panel, ciérralo con `stop` y arráncalo desde la app.

## 6. Botón de pánico

- **En el chat (tú o tus mods):** `!pausa` y `!reanudar`.
- **En el navegador:** http://localhost:3000/pausa y http://localhost:3000/reanudar.
- **Estado:** http://localhost:3000/estado.

Al pausar se descartan las acciones pendientes de la cola.

## Estructura

```
electron/main.js        app de escritorio (ventana, bandeja, atajo global)
iniciar.vbs             abre la app de escritorio sin terminal
src/
  index.js              arranque desde la terminal (npm start)
  app.js                arranque del backend (lo usan npm start y Electron)
  minecraftServer.js    iniciar/detener el servidor de Minecraft y su consola
  game/polls.js         votaciones del chat
  game/chaos.js         modo caos
  game/gameStore.js     guarda votaciones y modo caos en config/juego.json
  config.js             lee .env
  server.js             API del panel (/api) y servidor del panel compilado
  auth/twitchAuth.js    login OAuth con Twitch y renovación del token
  adapters/twitch.js    EventSub → eventos normalizados
  core/eventBus.js      cola, pausa y despacho de eventos
  core/rulesEngine.js   coincidencia de reglas, cooldowns y variables
  core/rulesStore.js    lectura/escritura validada de rules.json
  core/logger.js        logs en terminal + historial para el panel
  core/chatFeed.js      historial del chat en vivo para el panel
  actions/minecraft.js  RCON con reconexión automática
  actions/chat.js       respuestas en el chat
config/rules.json       tus reglas
scripts/simular.js      simulador de eventos
panel/                  panel de control (React + Vite)
```

Para agregar otra plataforma, crea `src/adapters/kick.js` que llame a `bus.emit({...})` con el mismo formato que usa `twitch.js`.
