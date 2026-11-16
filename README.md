# Sopa-ChatBot

*(el repositorio y la carpeta del proyecto se llaman `stream-interact`)*

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
  - `donation`: donación (Streamlabs, StreamElements o Ko-fi); se filtra con `minAmount`, `maxAmount` y `currency`.
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

## Overlay para OBS

La app sirve una página con fondo transparente para agregarla en OBS como **fuente de navegador** (1920×1080):

| URL | Qué muestra |
|-----|-------------|
| `http://localhost:3000/overlay` | Alertas y votación |
| `http://localhost:3000/overlay?widget=alertas` | Solo alertas (arriba al centro) |
| `http://localhost:3000/overlay?widget=votacion` | Solo la votación (abajo a la izquierda) |

- **Alertas:** cada vez que se ejecuta una regla (canje, comando, bits, ganador de una votación o evento del modo caos) aparece una alerta animada, en el mismo orden en que pasan las cosas en el juego. Si llegan varias juntas, salen una tras otra. Los **bits y las donaciones** muestran su alerta siempre que llegan, aunque no tengan una regla (si su regla tiene una *Alerta en overlay* propia, se usa esa).
- **Votación:** se ve en vivo con barras, porcentajes y tiempo restante. Al terminar muestra unos segundos el resultado.
- **Sonido:** cada alerta suena un tono corto, generado por la propia página, sin archivos. Marca *"Controlar audio mediante OBS"* en la fuente para oírlo y ajustarlo. `?sonido=0` en la URL lo apaga solo en esa fuente.
- **Texto propio:** en el editor de una regla, agrega la acción **Alerta en overlay** con tu texto y color; esa regla usará esa alerta en lugar de la automática.
- **Página "Overlay OBS" del panel:** las URLs para copiar, una **vista previa en vivo** y el editor de apariencia. Cada cambio se guarda solo y se aplica al instante, también en OBS, sin recargar la fuente.

### Personalizar la apariencia

- **Temas:** Clásico, Neón, Minimal, Pixel y Sin fondo, como punto de partida.
- **Posición:**
  - dónde aparecen las alertas y la votación (esquinas, centro, arriba o abajo);
  - su tamaño;
  - la separación de los bordes de la pantalla.
- **Animación:**
  - entrada: rebote, caída con rebotes, deslizar desde cualquier lado, zoom, voltear o aparecer suave;
  - salida;
  - velocidad y tiempo en pantalla;
  - destello, movimiento del ícono y barra de tiempo.
- **Estilo:**
  - tipografía, con 5 fuentes libres incluidas (una pixelada estilo retro); el tamaño y el color del texto;
  - un color por tipo de alerta;
  - fondo degradado, sólido o sin fondo, con su opacidad, borde, esquinas redondeadas y resplandor.
- **Imágenes y sonidos:** sube tus PNG, JPG, GIF o WEBP y tus MP3, OGG o WAV (arrastrándolos o con el botón). Asígnalos por tipo de alerta (canje, bits, comando, votación y caos). La imagen puede ir como ícono o grande arriba del texto.

Los archivos subidos se guardan en la carpeta `media/` del proyecto. Para una imagen o sonido en **una sola regla**, usa la acción *Alerta en overlay* en el editor de esa regla. Ahí también puedes elegir imagen y sonido.

La app tiene que estar abierta para que el overlay funcione. Si OBS se abre antes, el overlay se conecta solo cuando arranca la app.

### Pausar recompensas junto con "Pausar todo"

Al pausar (botón del panel, `!pausa` o `Ctrl+Shift+P`), las recompensas **creadas por la app** también se pausan en Twitch, para que nadie gaste puntos mientras tanto. Al reanudar, la app reanuda solo las que pausó ella. Si cierras la app estando en pausa, las reanuda la próxima vez que la abras. Se desactiva en *Reglas → Ajustes*.

## Donaciones (Streamlabs, StreamElements y Ko-fi)

En la página **Donaciones** del panel configuras cada servicio: pegas su token, lo activas o lo dejas guardado y desactivado para cuando lo necesites. Cada servicio muestra su estado (conectado, error, etc.) y tiene un botón para mandar una donación de prueba.

| Servicio | Cómo se conecta | Token |
|----------|-----------------|-------|
| Streamlabs | En tiempo real (Socket API) | streamlabs.com → *Account Settings → API Settings → API Tokens* → **Your Socket API Token** |
| StreamElements | En tiempo real (WebSocket "Astro", tema `channel.tips`) | streamelements.com → tu avatar → tu canal → **JWT Token** |
| Ko-fi | Webhook: necesita un túnel | ko-fi.com → *More → API → Webhooks → Advanced* → **Verification Token** |

- **Uso:** cada donación llega como un evento de tipo **Donación**. En el editor de reglas eliges el disparador *Donación* con monto mínimo, monto máximo y moneda (opcional). El monto se compara en la moneda en que llega, sin conversión.
- **Variables:** `{amount}` (50), `{currency}` (MXN) y `{money}` ($50.00 MXN).
- **Sin cooldown:** las donaciones nunca se descartan por cooldown, porque son dinero real.
- **Dónde se ven:** en el chat de la derecha y en el overlay, con su propio color, imagen y sonido (tipo *Donación* en Overlay OBS). Las respuestas al chat (acción *Responder en el chat*) salen en Twitch. Las donaciones de prueba no escriben en tu chat real.
- **Ko-fi:**
  - recibe en un puerto aparte (`WEBHOOK_PORT`, 3001), que solo acepta avisos con tu token de verificación; el panel nunca queda expuesto por el túnel;
  - las donaciones privadas salen como "Anónimo" y sin mensaje;
  - las membresías también cuentan como donación, y las órdenes de tienda no.
- **Túnel para Ko-fi:** `cloudflared tunnel --url http://localhost:3001`. Luego pon en Ko-fi la URL que te da, más `/webhooks/kofi`. Los pasos están en la página Donaciones.

Los tokens se guardan en `data/donaciones.json`, que no se sube a Git.

## Servidor de Minecraft desde la app

Agrega a tu `.env`:
```env
MC_SERVER_DIR=C:\Users\vitro\dev\mc-server
```
Con eso, en la página **Servidor** del panel puedes:
- iniciarlo, detenerlo y reiniciarlo;
- ver la consola en vivo y escribir comandos (con ↑ y ↓ recorres los anteriores).
- ver la **IP para compartir** con quien esté en tu misma red (botón Copiar);
- ver los **jugadores conectados** y expulsar a alguien;
- administrar la **lista blanca**: activarla o desactivarla, agregar y quitar jugadores.

Para que alguien de tu red entre, la red de Windows debe estar como **Privada** y el puerto 25565 permitido en el Firewall. Para gente de fuera de tu casa usa un túnel como Playit.gg (tipo **Minecraft Java**, IP local `127.0.0.1`, puerto 25565, Proxy Protocol en *None*). Pega la dirección del túnel en la tarjeta **Conectarse al servidor** para copiarla con un clic; se guarda en `config/servidor.json`.

Para que Playit se abra solo con la app, agrega `PLAYIT_AUTOSTART=true` a tu `.env` (la busca en `C:\Program Files\playit_gg\bin`; si la instalaste en otro lado, pon esa carpeta en `PLAYIT_PATH`). Abre el icono de la bandeja de Playit, que no tapa el juego. Si Playit ya está corriendo no lo vuelve a abrir, y al cerrar la app Playit sigue corriendo. Nunca abras a internet los puertos 25575 (RCON), 3000 ni 3001.

Si se cae, se reinicia solo en 10 segundos. Para evitar un ciclo de reinicios, se detiene después de 3 caídas en 5 minutos.

Con `MC_SERVER_AUTOSTART=true`, el servidor arranca junto con la app.

> Si el servidor ya está corriendo con `start.bat`, la app lo detecta como "fuera de la app": puede mandarle comandos por RCON, pero no ver su consola. Para controlarlo desde el panel, ciérralo con `stop` y arráncalo desde la app.

## Instalaciones (varios mundos: Vanilla, con mods…)

En la página **Instalaciones** registras varias carpetas de servidor; cada una tiene su propio mundo, lista blanca, mods o plugins. Solo una corre a la vez, siempre en el puerto 25565 (la dirección de Playit y tu IP local no cambian). La activa se elige ahí o en la parte de arriba de la página **Servidor**.

- La carpeta de `MC_SERVER_DIR` aparece sola como primera instalación. Renómbrala si quieres.
- Detecta Paper, Purpur, Vanilla, Fabric, Quilt, NeoForge y Forge. NeoForge y Forge se arrancan igual que su `run.bat`.
- Cada instalación puede usar su propio Java (detecta los que tengas en Archivos de programa) y su propia RAM. Si no eliges nada, usa lo del `.env`.
- Al iniciar, la app ajusta en `server.properties` el puerto (25565) y RCON (`enable-rcon`, `rcon.port`, `rcon.password` del `.env`) para controlarla igual que las demás.
- **Quitar** una instalación solo la saca del panel; no borra archivos.
- Se guardan en `config/instalaciones.json`.

Para una con mods: crea una carpeta, pon ahí el *server launcher* de Fabric o instala el servidor de NeoForge/Forge con su instalador (*Install server*), copia los mods a `mods/` y agrégala. Tus amigos necesitan la misma versión y los mismos mods.

## Reglas del mundo (gamerules) y chat limpio

En la página **Servidor**, tarjeta **Reglas del mundo** (con el servidor encendido): interruptores para conservar inventario, ciclo de día y noche, clima, mobs, PvP, mensajes de muerte, porcentaje para dormir, etc. Usa los nombres nuevos (`keep_inventory`, `advance_time`…) desde Minecraft 1.21.11 y los viejos (`keepInventory`…) en versiones anteriores, según la instalación. En Paper se aplican al mundo normal, al Nether y al End.

**Desde el chat (acción "Regla del mundo"):** en cualquier regla (recompensa, comando, bits, donación, votación o caos) agrega la acción *Regla del mundo*: elige la regla, cómo dejarla y por cuántos segundos. Al terminar vuelve sola a como estaba y avisa en Minecraft (puedes escribir tu propio mensaje). Si se vuelve a activar antes de terminar, el tiempo se suma. Con 0 segundos el cambio es permanente.

Ejemplo: 500 bits → *Regenerar vida con la comida* desactivada durante 300 s.

Los cambios pendientes se guardan en `config/gamerules-temporales.json`: si cierras la app o apagas el servidor, se regresan en cuanto vuelva a haber conexión (y solo en la instalación donde se hicieron). En la tarjeta *Reglas del mundo* se ve la cuenta regresiva y el botón *Terminar ya*.

**Mensajes "[Rcon: …]" en el chat:** apaga *Avisar en el chat los comandos de administradores* (`log_admin_commands`), que hace efecto al instante. Además, al iniciar cualquier instalación la app pone `broadcast-rcon-to-ops=false` y `broadcast-console-to-ops=false` en `server.properties`.

## Respaldos del mundo

En la página **Servidor**, tarjeta **Respaldos** (siempre de la instalación activa):

- **Automáticos** cada 2 horas mientras el servidor está encendido y **al detenerlo** (no al reiniciar ni si se cae). Se conservan los últimos 10; los manuales y los "Antes de restaurar" no se borran solos.
- **Respaldar ahora** en cualquier momento. Con el servidor encendido no hay riesgo: la app pausa el guardado (`save-off`), guarda todo (`save-all flush`), copia y lo reactiva (`save-on`). Nadie tiene que salir.
- **Restaurar** (con el servidor apagado): antes guarda una copia del mundo actual. Solo reemplaza las carpetas del mundo; la lista blanca y la configuración se quedan como están.
- Se guardan como `.zip` en `mc-backups\<instalación>` junto a la carpeta del servidor (por ejemplo `C:\Users\vitro\dev\mc-backups\principal`). En los ajustes puedes cambiar la carpeta, por ejemplo a otro disco.
- Usa el `tar.exe` que trae Windows 10/11; no hay que instalar nada. Ajustes en `config/respaldos.json`.

## Hordas, cosas al azar, bits ↔ donaciones y límites

- **Repetir:** la acción *Comandos de Minecraft* tiene *Repetir (veces)* (1–100) para hordas.
- **Al azar dentro de un comando** (cambia en cada repetición): `{azar:-4:4}` da un número entre -4 y 4 (para esparcir mobs: `~{azar:-4:4} ~ ~{azar:-4:4}`); `{elegir:bread|apple|cooked_beef}` elige una opción.
- **Mobs con el nombre de quien los mandó** (Minecraft 1.21.5 o más nuevo): `{CustomName:{text:"{user}",color:"gold"},CustomNameVisible:1b}`. Armadura: `equipment:{head:{id:"minecraft:iron_helmet",count:1},…}`; efectos: `active_effects:[{id:"minecraft:speed",amplifier:0b,duration:-1}]`.
- **Bits y donaciones en la misma regla:** en una regla de bits marca *También donaciones por su equivalente*. La tabla está en Reglas → Ajustes → *Bits y donaciones* (por defecto 1 USD = 100 bits, 1 MXN = 5 bits). Pon las reglas de más bits primero (o usa máximo).
- **Bits y donaciones nunca se pierden:** si llegan durante el cooldown, se ejecutan cuando termine y se avisa en el chat.
- **Máximo por directo:** cuántas veces se puede usar una regla en un mismo directo (si se pasa, se devuelven los puntos).
- **Acción *Activar modo caos*:** lo enciende por X minutos con las reglas de su lista y se apaga solo.

## Jugar con más gente: a quién le llega cada regla

Cada regla tiene **A quién le llega** (página Reglas):

| Objetivo | Qué hace |
|---|---|
| **Tú** | Como siempre: a `MC_PLAYER`. |
| **Lo elige el chat** | Recompensa con "Pedir texto al espectador" (escribe el nombre), `!comando Nombre`, o un nombre en el mensaje de bits/donación. |
| **Al azar** | Alguien conectado al azar (te incluye). |
| **Todos** | Todos los conectados. |

En los comandos usa `{target}` donde va el jugador (por ejemplo `give {target} minecraft:diamond 1`); `{player}` sigue siendo siempre tú. En textos (chat, mensajes, títulos), `{target}` es el nombre o "todos". El botón **Cambiar {player} por {target}** lo hace por ti.

- Solo se acepta un jugador **conectado**. Si no está o está protegido, en recompensas y comandos no se ejecuta, se avisa en el chat y se devuelven los puntos. En bits y donaciones nunca se pierde: te toca a ti.
- **Apodos** (Reglas → Jugadores y el chat): "many" → `ManyGamer123`. Mayúsculas y minúsculas dan igual.
- **Protegidos**: no reciben nada del chat (ni elegidos, ni al azar, ni en "todos"). Tú no te puedes proteger.
- Se guardan en `config/jugadores.json`.

**Modo caos con varios jugadores** (página Modo caos → *A quién le toca*):
- **Al azar** (predeterminado): cada evento le toca a alguien conectado al azar, tú incluido; nunca a los protegidos.
- **Lo que diga cada regla**: usa el objetivo de cada regla.
- **Todos**: a todos los conectados.

Las reglas cuyos comandos usan `{player}` siempre te llegan a ti; la página las marca como "solo a ti" y tiene un botón para cambiarlas a `{target}`.

## Estadísticas

La página **Estadísticas** muestra lo que hizo tu chat: interacciones, espectadores distintos, bits, donaciones (por moneda), lo que no se ejecutó (cooldown, rechazadas, fallidas), actividad en el tiempo, espectadores más activos, lo que más pidieron, a quién le tocó y un registro con buscador.

- Periodos: **Este directo**, Hoy, 7 días, 30 días, Todo, o un **directo anterior** de la lista (se separan solos cuando pasan más de 2 horas sin actividad).
- Las pruebas (botón Probar) no cuentan, salvo que marques *Incluir pruebas*.
- **Exportar CSV** descarga el periodo para abrirlo en Excel.
- Se guarda en `data/historial/AAAA-MM.jsonl` (un archivo por mes, una línea por interacción).

## Instalador de Windows

```powershell
npm install        # la primera vez (agrega electron-builder)
npm run dist       # compila el panel y crea el instalador
```

El instalador queda en `dist-instalador\Sopa-ChatBot-instalador-<versión>.exe`. Al abrirlo, Windows puede mostrar "Windows protegió tu PC" porque la app no está firmada: **Más información → Ejecutar de todas formas**.

- Se instala para tu usuario, con acceso directo en el escritorio y en el menú Inicio.
- **La primera vez pregunta dónde están tus datos** (`.env`, `config/`, `data/`, `media/`). Elige tu carpeta del proyecto (por ejemplo `C:\Users\vitro\dev\stream-interact`) para usar la misma configuración, reglas, historial y sesión de Twitch que en desarrollo. O crea una nueva en Documentos.
- En la bandeja: **Iniciar con Windows** (arranca directo en la bandeja), **Abrir carpeta de datos** y **Cambiar carpeta de datos…**
- Para actualizar: `npm run dist` otra vez y ejecuta el nuevo instalador encima; tus datos no se tocan. Desinstalar tampoco los borra.
- Si usas la versión instalada y `npm run desktop` con la misma carpeta de datos, no abras las dos a la vez (usan el mismo puerto).

## Actualizaciones automáticas

La versión instalada revisa al abrirse (y cada 4 horas) si hay una versión nueva en las [Releases del repositorio](https://github.com/SopaHeladaGames/stream-interact/releases), la descarga sola y te avisa (notificación, bandeja y abajo del menú del panel). Nunca reinicia sola: le das **Reiniciar y actualizar** cuando quieras, o se instala al salir de la app. Tus datos no se tocan.

**Publicar una versión** (desde la carpeta del proyecto, con tus cambios listos):

```powershell
npm run publicar                         # arreglos: 0.2.0 → 0.2.1
npm run publicar -- minor "Estadísticas"   # funciones nuevas: 0.2.1 → 0.3.0
```

Eso sube el número de versión, hace commit, crea el tag y hace push. GitHub Actions (`.github/workflows/release.yml`) compila el instalador en Windows y lo publica en Releases en unos 5 minutos; puedes seguirlo en la pestaña **Actions** del repositorio.

No se suben `.env`, `data/`, `media/` ni tu configuración personal de `config/` (solo `config/rules.json`, que el instalador usa como reglas de ejemplo).

## 6. Botón de pánico

- **En el chat (tú o tus mods):** `!pausa` y `!reanudar`.
- **En el navegador:** http://localhost:3000/pausa y http://localhost:3000/reanudar.
- **Estado:** http://localhost:3000/estado.

Al pausar se descartan las acciones pendientes de la cola.

## Estructura

```
electron/main.js        app de escritorio (ventana, bandeja, atajo global)
iniciar.vbs             abre la app de escritorio sin terminal
overlay/index.html      overlay para OBS (alertas y votación)
overlay/fonts/          fuentes libres (OFL) usadas por el overlay
media/                  tus imágenes y sonidos para las alertas
src/
  index.js              arranque desde la terminal (npm start)
  app.js                arranque del backend (lo usan npm start y Electron)
  minecraftServer.js    iniciar/detener el servidor de Minecraft y su consola
  donations/            Streamlabs, StreamElements y Ko-fi (conexión, reconexión y webhooks)
  core/money.js         formato de montos ($50.00 MXN)
  game/polls.js         votaciones del chat
  game/chaos.js         modo caos
  game/gameStore.js     guarda votaciones, modo caos y overlay en config/juego.json
  game/overlayConfig.js ajustes de apariencia del overlay (valores por defecto y validación)
  config.js             lee .env
  server.js             API del panel (/api) y servidor del panel compilado
  auth/twitchAuth.js    login OAuth con Twitch y renovación del token
  adapters/twitch.js    EventSub → eventos normalizados
  core/eventBus.js      cola, pausa y despacho de eventos
  core/rulesEngine.js   coincidencia de reglas, cooldowns y variables
  core/rulesStore.js    lectura/escritura validada de rules.json
  core/logger.js        logs en terminal + historial para el panel
  core/chatFeed.js      historial del chat en vivo para el panel
  core/overlayFeed.js   alertas en vivo para el overlay
  actions/overlay.js    acción "Alerta en overlay" y texto de las alertas automáticas
  actions/minecraft.js  RCON con reconexión automática
  actions/chat.js       respuestas en el chat
config/rules.json       tus reglas
scripts/simular.js      simulador de eventos
panel/                  panel de control (React + Vite)
```

Para agregar otra plataforma, crea `src/adapters/kick.js` que llame a `bus.emit({...})` con el mismo formato que usa `twitch.js`.
