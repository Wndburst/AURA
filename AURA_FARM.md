# ☠️ AURA FARM ☠️ — Especificación funcional y técnica

> App web en tiempo real para organizar **juntas de farmeo de aura**: batallas 1v1 donde el
> público juzga y reparte (o quita) AURA a los contrincantes.

---

## 1. Concepto

Un grupo se junta en una comuna / región. Alguien crea un **lobby** y comparte el código.
Todos entran con su **nickname**. Cualquiera puede apretar **BATALLAR ☠️** y quedar
*buscando contrincante*. Cuando dos personas están buscando, el sistema los **matchea** y
agenda una batalla.

Durante la batalla, **todo el resto del lobby juzga**: aprieta botones de `+25.000` /
`-99.999` AURA sobre uno u otro contrincante. Al terminar, el aura acumulada se suma al
**leaderboard** del lobby.

---

## 2. Flujo de pantallas

```
┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
│ 1. NICKNAME     │──▶│ 2. CREAR / UNIRSE    │──▶│ 3. LOBBY                     │
│ "¿cómo te       │   │  · CREAR LOBBY       │   │  · Leaderboard               │
│  llaman?"       │   │  · UNIRSE (código)   │   │  · Conectados                │
└─────────────────┘   └──────────────────────┘   │  · Batallas (cola/agenda)    │
                                                 │  · [ BATALLAR ☠️ ]           │
                                                 └──────────┬───────────────────┘
                                                            │ hay batalla activa
                                                            ▼
                                                 ┌──────────────────────────────┐
                                                 │ 4. ARENA (juzgar)            │
                                                 │  NICK_A  vs  NICK_B          │
                                                 │  +25k +75k +99.999           │
                                                 │  -25k -75k -99.999           │
                                                 └──────────────────────────────┘
```

### 2.1 Pantalla 1 — Nickname
- Un input, mínimo 2 y máximo 20 caracteres.
- Se persiste en `localStorage` junto a un `playerId` (UUID) para sobrevivir refresh.
- El `playerId` es la identidad real; el nickname es editable después.

### 2.2 Pantalla 2 — Crear / Unirse
- **CREAR LOBBY** → el servidor genera un `id` (UUID v4) y un **código corto** de 6
  caracteres (alfabeto sin ambigüedades: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
  Ambos sirven para entrar. El código corto es el que se dicta en voz alta.
- **UNIRSE** → se pega el código o la URL completa (`/l/ABC123`).
- Sin límite de usuarios por lobby.

### 2.3 Pantalla 3 — Lobby
Tres vistas (tabs):

| Vista | Contenido |
|---|---|
| **LEADERBOARD** | Ranking por AURA acumulada. Incluye a quien ya se desconectó (el aura no se pierde). Muestra 🥇🥈🥉, W/L y batallas jugadas. |
| **CONECTADOS** | Sólo usuarios online *ahora*. Marca quién está `BUSCANDO`, quién está `EN BATALLA` y quién es el host. |
| **BATALLAS** | Batalla en curso + agendada + cola de próximas + historial de las últimas 20 con su resultado. |

Barra inferior fija con el botón **BATALLAR ☠️** (toggle: buscar / cancelar búsqueda).

### 2.4 Pantalla 4 — Arena
- Aparece cuando hay batalla `SCHEDULED` o `ACTIVE`.
- `SCHEDULED`: cuenta regresiva de **60 s** para que los contrincantes se preparen.
- `ACTIVE`: **120 s** de juicio popular.
- Muestra los dos nicknames, su aura en vivo, la barra de dominancia, el feed de juicios
  y los 6 botones de juicio por contrincante.
- `FINISHED`: pantalla de resultado con ganador y aura final; se queda visible ~20 s.

---

## 3. Reglas del juego

### 3.1 Matchmaking
1. Un usuario aprieta `BATALLAR ☠️` → entra a la **cola de búsqueda** (FIFO).
2. Cuando hay ≥ 2 en cola, se sacan los dos primeros y se crea una **batalla**.
3. Si **no hay batalla en curso ni agendada** → la batalla queda `SCHEDULED`, empieza en
   **60 s**.
4. Si **ya hay una batalla en curso o agendada** → la nueva queda `QUEUED`. Al terminar la
   anterior, la siguiente pasa a `SCHEDULED` con sus 60 s de preparación.
5. Salir del lobby o desconectarse te saca de la cola de búsqueda.

### 3.2 Ciclo de vida de una batalla

```
QUEUED ──(el carril está libre)──▶ SCHEDULED ──60s──▶ ACTIVE ──120s──▶ FINISHED
                                       ▲                                   │
                                       │                          +20s     ▼
                                       └── la siguiente entra ya      historial
                                           mientras se muestra
                                           el resultado
```

Al terminar, la batalla **libera el carril de inmediato** y pasa a `lastResult`, donde vive
`RESULT_MS` mostrándose en pantalla. La siguiente de la cola arranca su minuto de
preparación en paralelo, no después: si esperara a que el marcador desaparezca, cada batalla
le robaría 20 s de preparación a la siguiente.

Todos los tiempos son **autoritativos del servidor**: se envían timestamps absolutos
(`startsAt`, `endsAt`) y el cliente calcula la cuenta regresiva usando un *offset* de reloj
medido al conectar. Nadie puede adelantar su reloj para ganar tiempo.

### 3.3 Juicio (votación)
- Montos fijos: `+25.000`, `+75.000`, `+99.999` y `-25.000`, `-75.000`, `-99.999`.
- Sólo durante `ACTIVE`.
- **Los contrincantes no pueden juzgar su propia batalla** (ni a sí mismos ni al rival).
- Cada juez tiene **10 juicios por batalla** (`MAX_JUDGMENTS_PER_BATTLE`) y un **cooldown
  de 700 ms** entre juicios (`JUDGMENT_COOLDOWN_MS`).

  > *Decisión de diseño:* el enunciado no fijaba un límite. Sin límite, un solo dedo rápido
  > (o un script) decide la batalla y el número deja de significar algo. Con un presupuesto
  > de juicios el público tiene que **elegir** a quién apoyar, que es justamente la gracia.
  > Ambos valores son configurables por variable de entorno; poner
  > `MAX_JUDGMENTS_PER_BATTLE=0` los vuelve ilimitados.

### 3.4 Resultado
- Al expirar los 120 s: gana quien tenga **más aura acumulada en la batalla**. Empate posible.
- El aura de la batalla se **suma al leaderboard** de cada contrincante (puede ser negativa:
  se puede terminar la batalla con menos aura de la que se entró — eso es aura farming real).
- Se registran `wins` / `losses` / `battles`.

---

## 4. Arquitectura

```
┌──────────────────────────── 1 solo servicio desplegable ─────────────────────────────┐
│                                                                                       │
│   client/  React 19 + Vite + TypeScript                                              │
│      │  build → dist/  ─────────────────┐                                            │
│      │                                   │  (en producción el servidor sirve el dist) │
│   server/  Node 20+ · Express · Socket.IO · TypeScript                               │
│      ├── HTTP   → /api/health, /api/lobbies, /api/lobbies/:code, /api/stats          │
│      ├── WS     → Socket.IO, una room por lobby                                      │
│      ├── Estado → en memoria (Map) — autoridad única                                 │
│      └── Persistencia → snapshot JSON debounced (data/aura-farm.json)                │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Por qué así:**
- El juego es 100 % tiempo real y efímero → una **base de datos es puro peso muerto**. El
  estado vive en memoria y se persiste como snapshot para sobrevivir un reinicio.
- **Un solo proceso** que sirve API + WebSocket + estáticos → un solo deploy, un solo
  dominio, cero CORS en producción, cabe en el free tier de cualquier PaaS.
- El servidor es **autoritativo**: el cliente nunca calcula aura ni tiempos. Todo lo que
  llega del cliente se valida.

### 4.1 Modelo de datos (en memoria)

```ts
Lobby {
  id: uuid, code: 'ABC123', name, createdAt, hostId, lastActivityAt,
  players: Map<PlayerId, Player>,
  searching: PlayerId[],          // cola FIFO de matchmaking
  current: Battle | null,         // SCHEDULED o ACTIVE
  lastResult: Battle | null,      // FINISHED, mientras se muestra el marcador
  queue: Battle[],                // QUEUED
  history: Battle[]               // últimas 20 FINISHED
}

Player { id, nickname, aura, wins, losses, battles, online, sockets:Set, joinedAt, lastSeen }

Battle {
  id, lobbyId, status, a:{id,nickname}, b:{id,nickname},
  auraA, auraB, judgments:[], judgeUsage: Map<PlayerId, {count, lastAt}>,
  createdAt, startsAt?, endsAt?, finishedAt?, winnerId?: string|null
}
```

### 4.2 Protocolo Socket.IO

**Cliente → Servidor** (todos con ACK `{ok:true,…} | {ok:false,error}`)

| Evento | Payload |
|---|---|
| `hello` | `{ playerId?, nickname }` → `{ playerId, serverTime, config }` |
| `lobby:create` | `{ nickname, lobbyName? }` |
| `lobby:join` | `{ code, nickname }` |
| `lobby:leave` | — |
| `player:rename` | `{ nickname }` |
| `battle:search` | — (entra a la cola) |
| `battle:cancelSearch` | — |
| `battle:judge` | `{ battleId, targetId, amount }` |
| `time:sync` | — → `{ serverTime }` |

**Servidor → Cliente**

| Evento | Uso |
|---|---|
| `lobby:state` | Estado del lobby. `players` sólo va cuando la lista cambió (ver abajo). Máx. **4 Hz**. |
| `battle:live` | `{ battleId, auraA, auraB, judgeCount }` — vía rápida a **10 Hz**. |
| `battle:feed` | Array de juicios recientes (batch cada 150 ms) para el feed visual. |
| `battle:phase` | Cambio de fase (`SCHEDULED`/`ACTIVE`/`FINISHED`) — dispara animaciones. |
| `battle:finished` | Resultado con ganador. |
| `battle:archived` | La batalla pasó al historial; el carril quedó libre. |
| `you` | Estado personal (`searching`, `judgmentsLeft`, …). |
| `error` | Errores no atados a un ACK. |

#### Difusión coalescida

Sin límite de usuarios, la difusión es lo primero que se cae. Tres decisiones la sostienen:

1. **Nada emite al lobby directamente.** Entrar, salir, renombrarse o cambiar de fase sólo
   marcan el lobby como sucio; un único bucle decide cuándo sale el mensaje. Sin esto, 200
   personas entrando generan 200 broadcasts a 200 destinatarios: **O(n²) bytes** justo en el
   peor momento.
2. **La lista de jugadores viaja aparte del resto del estado.** Es la parte pesada (~30 KB
   con 200 personas) y casi nunca cambia dos veces en el mismo segundo, así que va como
   máximo cada `ROSTER_BROADCAST_MS` (1,5 s) y sólo si cambió. Cuando `lobby:state` llega
   sin `players`, el cliente conserva la lista que ya tenía.
3. **El aura en vivo tiene su propio canal mínimo.** `battle:live` son cuatro números a
   10 Hz; los juicios individuales viajan en lotes cada 150 ms.

Medido con 200 clientes juzgando a la vez (`npm run test:load 200`): **7,4 MB** de tráfico
total y p99 de 17 ms en el ACK de juicio. La versión sin coalescing generaba **506 MB** en
la misma prueba.

### 4.3 Reconexión
El `playerId` vive en `localStorage`. Al reconectar, el socket se re-asocia al jugador
existente: no se pierde aura, ni el puesto en el leaderboard, ni la batalla en curso.
Un jugador puede tener varias pestañas abiertas (`sockets: Set`).

### 4.4 Seguridad / anti-abuso
- Nicknames sanitizados (sin control chars, colapso de espacios, máx. 20, unicidad blanda
  con sufijo `#2` dentro del lobby).
- Validación estricta de todos los payloads (montos permitidos en una whitelist).
- *Token bucket* por socket (30 eventos / 10 s) para todo lo que no sea juicio.
- Cooldown + presupuesto por juez en los juicios.
- `helmet`, CORS restringido por env, límite de tamaño de payload.
- Los contrincantes no pueden votar en su propia batalla.

### 4.5 Ciclo de vida / limpieza
- Un `tick` global cada 250 ms hace avanzar fases de todas las batallas.
- Lobbies sin actividad por 6 h se eliminan (`LOBBY_TTL_MS`).
- Jugadores offline se mantienen en el leaderboard (el aura es del lobby, no de la sesión).

---

## 5. Stack

| Capa | Elección | Motivo |
|---|---|---|
| Servidor | Node 20+ / TypeScript / Express 4 | Estándar, tipado, deploy trivial. |
| Tiempo real | Socket.IO 4 | Rooms, reconexión y ACKs listos; fallback a polling en redes malas de evento presencial. |
| Cliente | React 19 + Vite 7 + TypeScript | Build rápido, bundle chico. |
| Estado cliente | Zustand | ~1 kB, sin boilerplate. |
| Estilos | CSS puro con variables | Sin cadena de build extra; estética 100 % a mano. |
| Tests | `node:test` | Sin dependencias; cubre matchmaking, fases y juicios. |
| Deploy | Docker multi-stage / Render / Fly.io / Railway | Un solo contenedor. |

---

## 6. Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP. |
| `NODE_ENV` | `development` | En `production` sirve `client/dist`. |
| `CORS_ORIGIN` | `*` en dev | Orígenes permitidos, separados por coma. |
| `PREP_MS` | `60000` | Preparación antes de la batalla. |
| `BATTLE_MS` | `120000` | Duración de la batalla. |
| `RESULT_MS` | `20000` | Cuánto queda el resultado en pantalla. |
| `MAX_JUDGMENTS_PER_BATTLE` | `10` | Juicios por juez por batalla (`0` = ilimitado). |
| `JUDGMENT_COOLDOWN_MS` | `700` | Cooldown entre juicios. |
| `LOBBY_TTL_MS` | `21600000` | TTL de lobby inactivo (6 h). |
| `STATE_BROADCAST_MS` | `250` | Cadencia máxima del estado del lobby. |
| `ROSTER_BROADCAST_MS` | `1500` | Cadencia máxima de la lista de jugadores. |
| `DATA_DIR` | `./data` | Dónde se guarda el snapshot. |
| `PERSISTENCE` | `on` | `off` desactiva el snapshot. |

---

## 7. Criterios de aceptación

- [x] Pantalla de nickname persistente entre recargas.
- [x] Crear lobby → UUID + código corto compartible por link.
- [x] Unirse por código o por URL directa.
- [x] Sin límite de usuarios por lobby.
- [x] Leaderboard ordenado por aura, con medallas y W/L.
- [x] Lista de conectados en vivo con estados.
- [x] Vista de próximas batallas + cola + historial.
- [x] Botón `BATALLAR ☠️` → estado *buscando contrincante*.
- [x] Match automático al haber 2 buscando.
- [x] 1 minuto de preparación; encolado si ya hay una en curso.
- [x] Arena de juicio con los 6 montos fijos.
- [x] 2 minutos de batalla, resultado y actualización del leaderboard.
- [x] Reconexión sin pérdida de estado.
- [x] Responsive: pensado para usarse **desde el celular, parados en una plaza**.

---

## 8. Estado de la implementación

| Verificación | Resultado |
|---|---|
| Unitarios del dominio (`npm test`) | 26/26 |
| End-to-end sobre sockets reales (`npm run test:e2e`) | 50/50 |
| Carga, 200 clientes en un lobby (`npm run test:load 200`) | p99 17 ms · 0 rechazos · 7,4 MB |
| Persistencia entre reinicios | verificada (aura, victorias y lobby recuperados) |
| `npm run typecheck` (servidor y cliente) | limpio |
| Imagen Docker | definida; **no construida en esta máquina** (el demonio de Docker no estaba disponible) |
