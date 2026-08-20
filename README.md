# ☠️ AURA FARM ☠️

App web en tiempo real para las **juntas de farmeo de aura**: alguien crea un lobby, comparte
un código de 6 caracteres, y la gente entra desde el celular. Dos personas se enfrentan y
**todo el resto juzga**, repartiendo o quitando aura a golpe de botón. Al final, el aura se
suma al leaderboard del lobby.

```
NICKNAME  →  CREAR / UNIRSE  →  LOBBY  →  ARENA
                                  │        (juzgar en vivo)
                          leaderboard · conectados · batallas
```

- **Especificación completa:** [AURA_FARM.md](AURA_FARM.md)
- **Cómo desplegarlo:** [DEPLOY.md](DEPLOY.md)

---

## Partir en 30 segundos

```bash
npm install
npm run build
npm start            # http://localhost:8080  (tiempos reales: 1 min + 2 min)
npm run start:fast   # http://localhost:8080  (8 s + 25 s, para probar sin esperar)
```

Para desarrollo con recarga en caliente (servidor en `:8080`, front en `:5173` con proxy):

```bash
npm run dev
```

Y para probarlo de verdad: abre `http://localhost:5173` en dos o tres pestañas —cada una en
ventana de incógnito, porque la identidad se guarda en `localStorage`— crea un lobby en una,
únete con el código en las otras, y aprieta **BATALLAR ☠️** en dos de ellas. La tercera es
la que juzga.

Desde el celular en la misma red: usa la IP de tu máquina (`ipconfig` en Windows,
`ip addr` en Linux), por ejemplo `http://192.168.1.10:8080`.

### Configuración sin pelear con la shell

Los ajustes viven en un archivo `.env` que Node carga solo al arrancar — no hay que exportar
variables a mano, y menos lidiar con que `VAR=x comando` no existe en PowerShell.

```powershell
Copy-Item .env.example .env    # o `cp .env.example .env` en bash
```

Edita `.env`, reinicia, listo. Hay dos presets ya listos y versionados:

| Comando | Para qué |
|---|---|
| `npm start` | Lee tu `.env`. Si no existe, usa los defaults. |
| `npm run start:fast` | Preparación 8 s, batalla 25 s. Para probar sin esperar. |
| `npm run start:test` | Puerto 8099 y tiempos mínimos. Lo usan las pruebas de integración. |

> Las variables del entorno real tienen prioridad sobre el archivo, así que en producción el
> hosting manda y un `.env` colado en la imagen no puede pisarlo.

---

## Qué hay adentro

```
aura-farm/
├── server/                 Node + TypeScript + Express + Socket.IO
│   ├── src/
│   │   ├── domain/         lobby.ts · battle.ts   ← las reglas del juego, sin red
│   │   ├── realtime/       gateway.ts             ← Socket.IO, difusión coalescida
│   │   ├── store/          estado en memoria + snapshot en disco
│   │   ├── util/           ids, nicknames, rate limiting
│   │   └── index.ts        HTTP, estáticos, apagado ordenado
│   └── test/               unitarios (node:test), e2e y prueba de carga
├── client/                 React 19 + Vite + TypeScript
│   └── src/
│       ├── screens/        nickname · crear/unirse · lobby
│       ├── components/     arena, leaderboard, conectados, batallas
│       ├── store/          Zustand + listeners de socket
│       └── lib/            socket, reloj sincronizado, formato, sonido
├── Dockerfile              imagen multi-stage, un solo contenedor
├── render.yaml · fly.toml  despliegue listo para copiar
└── AURA_FARM.md            especificación funcional y técnica
```

**Una sola cosa desplegable.** En producción el mismo proceso Node sirve la API, el
WebSocket y el front compilado. Un dominio, cero CORS, cabe en la instancia más chica de
cualquier PaaS.

**Sin base de datos.** El juego es efímero y 100 % en vivo: el estado vive en memoria y se
guarda un snapshot JSON para que un reinicio no borre el aura de nadie. Meter Postgres acá
sería peso muerto.

**El servidor manda.** El cliente nunca calcula aura ni tiempos: manda intenciones y recibe
hechos. Los montos van en una whitelist, los relojes son timestamps absolutos del servidor,
y los contrincantes no pueden votar en su propia batalla.

---

## Las reglas, en corto

| | |
|---|---|
| **Matchmaking** | Cola FIFO. Con 2 personas buscando, nace una batalla. |
| **Preparación** | 60 s antes de que empiece. Si ya hay una en curso, la nueva espera en cola y recibe su propio minuto cuando le toca. |
| **Batalla** | 120 s. El público reparte `±25.000`, `±75.000`, `±99.999` de aura. |
| **Límite de juicios** | 10 por juez por batalla, con 700 ms de cooldown. Configurable; `0` = ilimitado. |
| **Resultado** | Gana quien acumuló más aura. El total —positivo o negativo— se suma al leaderboard. |
| **Reconexión** | La identidad vive en `localStorage`: recargar, cambiar de red o cerrar la app no te quita el aura. |

El porqué del límite de juicios y el resto de las decisiones de diseño están en
[AURA_FARM.md](AURA_FARM.md#33-juicio-votación).

---

## Tests

```bash
npm test           # 26 unitarios del dominio: matchmaking, fases, juicios, resultados
npm run typecheck  # servidor y cliente
```

Los de integración necesitan un servidor levantado en el puerto 8099:

```bash
# terminal 1
npm run start:test

# terminal 2
npm run test:e2e          # 50 verificaciones sobre sockets reales
npm run test:load 200     # 200 clientes en un lobby, mide latencia y tráfico
```

La prueba de carga es la que importa antes de un evento grande — mide exactamente lo que se
cae primero: la difusión del estado. Los números medidos están en
[DEPLOY.md](DEPLOY.md#cuánto-aguanta).

---

## Configuración

Todo tiene default sensato y se puede desplegar sin tocar nada. En local van en `.env`
(copia de [.env.example](.env.example)); en producción, como variables de entorno del
hosting. Las que más se usan:

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP. |
| `PREP_MS` | `60000` | Preparación antes de la batalla. |
| `BATTLE_MS` | `120000` | Duración de la batalla. |
| `MAX_JUDGMENTS_PER_BATTLE` | `10` | Juicios por juez. `0` = ilimitado. |
| `PERSISTENCE` | `on` | `off` para no guardar nada en disco. |

---

☠️ **+999.999.999.999 AURA** ☠️
