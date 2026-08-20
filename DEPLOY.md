# ☠️ Cómo desplegar AURA FARM ☠️

La app es **un solo contenedor**: un proceso Node que sirve la API, el WebSocket y el front
compilado. No necesita base de datos, ni Redis, ni nada más.

---

## Lo único que no puedes olvidar

> ### ⚠️ Una sola instancia
>
> El estado de los lobbies vive **en la memoria del proceso**. Si el hosting levanta dos
> instancias detrás de un balanceador, la gente del mismo lobby cae en procesos distintos y
> no se ven entre sí: dos leaderboards paralelos, batallas que la mitad no ve.
>
> En todos los archivos de configuración de este repo ya está fijado en 1 instancia. Si
> algún día necesitas escalar horizontalmente, lee [Escalar de verdad](#escalar-de-verdad).

> ### ⚠️ Nada de planes que "duermen"
>
> Los free tier que se suspenden por inactividad (Render Free, entre otros) tardan 30-60 s
> en despertar. En una junta con gente parada esperando, eso es la muerte. Usa un plan que
> se mantenga despierto — son unos pocos dólares al mes.

---

## Opción 1 — Fly.io (la que recomiendo)

Tiene región en **Santiago (`scl`)**, que para un evento en Chile significa ~10 ms de
latencia en vez de ~150 ms yendo a Estados Unidos. En una app donde la gracia es apretar
botones al mismo tiempo, se nota.

```bash
# 1. Instalar y entrar
curl -L https://fly.io/install.sh | sh     # en Windows: iwr https://fly.io/install.ps1 -useb | iex
fly auth signup                            # o: fly auth login

# 2. Desde la raíz del proyecto
cd aura-farm

# 3. Elige un nombre libre y ponlo en fly.toml (campo `app`)
#    Ese nombre define la URL: https://<nombre>.fly.dev
fly apps create mi-aura-farm

# 4. Volumen para que el leaderboard sobreviva a los redeploys
fly volumes create aura_data --size 1 --region scl

# 5. Al aire
fly deploy
fly open
```

`fly.toml` ya viene con la región `scl`, el volumen montado en `/data`, el health check y
`min_machines_running = 1` para que no se duerma.

**Dominio propio:**

```bash
fly certs add aurafarm.cl
fly ips list                # te da las IPs para el DNS
```

Luego, en tu proveedor de DNS: un `A` a la IPv4 y un `AAAA` a la IPv6 que te mostró el
comando. El certificado HTTPS lo emite Fly solo, en un par de minutos.

---

## Opción 2 — Render

Más simple si prefieres apretar botones en vez de usar la terminal.

1. Sube el proyecto a un repositorio de GitHub.
2. En [render.com](https://render.com) → **New** → **Blueprint**, y apunta al repo. Render
   lee [`render.yaml`](render.yaml) y configura todo solo.
3. Confirma que el plan sea **Starter** o superior (el Free duerme).
4. Deploy.

Queda en `https://aura-farm.onrender.com`. Para dominio propio: **Settings → Custom Domain**,
y en tu DNS un `CNAME` a la URL de Render.

---

## Opción 3 — Railway

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

En el panel: **Settings → Networking → Generate Domain**. Railway detecta el `Dockerfile`
solo. Agrega un volumen montado en `/app/data` si quieres persistencia entre despliegues.

---

## Opción 4 — Tu propio VPS

Para un DigitalOcean / Hetzner / Vultr de 5 dólares, que aguanta esto de sobra.

```bash
# En el servidor (Ubuntu)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
git clone <tu-repo> aura-farm && cd aura-farm

docker build -t aura-farm .
docker run -d \
  --name aura-farm \
  --restart unless-stopped \
  --init \
  -p 80:8080 \
  -v aura-data:/app/data \
  -e NODE_ENV=production \
  aura-farm
```

Para HTTPS, lo más corto es Caddy delante (saca el certificado solo):

```bash
# /etc/caddy/Caddyfile
aurafarm.cl {
    reverse_proxy localhost:8080
}
```

> Si usas nginx en vez de Caddy, acuérdate de habilitar el upgrade de WebSocket
> (`proxy_set_header Upgrade $http_upgrade;` y `proxy_set_header Connection "upgrade";`),
> o Socket.IO va a caer a polling y la app se sentirá pegajosa.

---

## Sin Docker (Node directo)

```bash
npm ci
npm run build
npm start          # lee el archivo .env si existe
```

Node carga `.env` solo al arrancar (`--env-file-if-exists`), así que en un servidor propio
basta con dejar ahí la configuración:

```ini
# .env, junto al package.json
NODE_ENV=production
PORT=8080
PREP_MS=60000
BATTLE_MS=120000
```

> Las variables del entorno real ganan sobre el archivo. En Render, Fly o Railway define
> todo en el panel del servicio y ni siquiera necesitas `.env`.

Con systemd, para que sobreviva reinicios:

```ini
# /etc/systemd/system/aura-farm.service
[Unit]
Description=Aura Farm
After=network.target

[Service]
Type=simple
User=aura
WorkingDirectory=/opt/aura-farm
Environment=NODE_ENV=production
Environment=PORT=8080
ExecStart=/usr/bin/node server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now aura-farm
```

---

## Ajustes antes de un evento

Todo se cambia sin recompilar: en el panel del hosting, o en el `.env` si corres en tu
propio servidor.

```ini
# Batallas más cortas para que roten rápido con mucha gente en fila
PREP_MS=45000
BATTLE_MS=90000

# Más juicios por persona si el grupo es chico (menos de 15)
MAX_JUDGMENTS_PER_BATTLE=20

# Caos total: sin límite de juicios (el número deja de significar mucho, pero es divertido)
MAX_JUDGMENTS_PER_BATTLE=0
JUDGMENT_COOLDOWN_MS=300
```

Y una recomendación práctica: proyecta la vista de **batallas** en un notebook conectado a
un parlante, con la app abierta en el lobby. La arena está pensada para verse de lejos.

---

## Cuánto aguanta

Medido con `npm run start:load` + `npm run test:load 300`: 300 clientes reales en un solo
lobby, **todos juzgando a la máxima velocidad que permite el cooldown** — mucho más intenso
que un evento de verdad.

| Métrica | Resultado |
|---|---|
| Clientes simultáneos en un lobby | 300 |
| Juicios procesados | 2.384, ninguno rechazado por error |
| Latencia del ACK de juicio | p50 **33 ms** · p95 **66 ms** · p99 **67 ms** |
| Memoria del proceso | **64 MB** en reposo · **96 MB** con los 300 encima |
| Egreso total | 81 KB por persona en 7 s de juicio continuo |

Esos 96 MB son la razón por la que **cualquier plan sirve**: la instancia más barata de
cualquier proveedor trae 256 MB o más.

### Las tres cosas que hacen que aguante

1. **Difusión coalescida** (`flushLobby()` en
   [server/src/realtime/gateway.ts](server/src/realtime/gateway.ts)). Nada emite al lobby
   directamente: todo marca el estado como sucio y un único bucle decide cuándo sale. La
   versión ingenua generaba **506 MB** donde ahora hay 7: la lista de jugadores se reenviaba
   entera a todos cada vez que alguien entraba — O(n²) justo cuando llega la multitud.
2. **El roster viaja aparte del resto del estado**, como máximo cada 1,5 s y sólo si cambió.
   Es la parte pesada (~30 KB con 200 personas) y casi nunca cambia dos veces por segundo.
3. **El feed va recortado** a los últimos `MAX_FEED_BATCH` (8) juicios por lote. La arena
   muestra 6 líneas; mandar los cientos de juicios por segundo que llegan con mucha gente
   era el grueso del tráfico. Recortarlo bajó el egreso de **202 KB a 37 KB por persona** y
   la latencia p99 de 259 ms a 24 ms, sin ninguna diferencia visible en pantalla.

### Si esperas muchísima gente

Sube `ROSTER_BROADCAST_MS` a `3000` y baja `MAX_FEED_BATCH` a `4`, y vuelve a medir con
`npm run test:load` antes del evento. Con una instancia compartida de 512 MB deberías estar
tranquilo hasta varios cientos de personas **por lobby** (lobbies distintos son
independientes entre sí y escalan sin problema).

---

## Cuánto cuesta

La app pide tan poco (96 MB de RAM, CPU casi en cero) que el costo lo define el proveedor,
no el consumo.

> Los precios cambian seguido — verifica el actual antes de contratar. Estos son órdenes de
> magnitud, no cotizaciones.

| Opción | Costo aprox. | Comentario |
|---|---|---|
| **Oracle Cloud Always Free** | **US$0** | Gratis de verdad y para siempre. Máquina ARM muchísimo más grande de lo necesario. A cambio: es un VM pelado (instalas Docker y Caddy tú) y la disponibilidad del tier gratis varía por región. |
| **Fly.io** | ~US$2-5/mes | Región **Santiago (`scl`)**. Ya está configurado en `fly.toml`: son tres comandos. La mejor relación esfuerzo/latencia. |
| **Render Starter** | ~US$7/mes | El más simple de todos (Blueprint y listo). El plan Free duerme a los 15 min. |
| **Railway** | ~US$5/mes | Detecta el Dockerfile solo. |
| **VPS cualquiera** (Hostinger, Hetzner, DigitalOcean…) | ~US$5-8/mes | Funciona perfecto. Control total, algo más de trabajo de setup. |

### ⚠️ Los hosting compartidos NO sirven

Planes tipo **Hostinger "Unlimited"/"Premium"/"Business"**, o cualquier hosting con cPanel
pensado para WordPress, son para **PHP**: ejecutan un script y lo matan al responder. Esta
app necesita un **proceso Node corriendo permanentemente** con conexiones WebSocket abiertas.
No es cosa de configurarlo distinto: el modelo de ejecución es otro.

De Hostinger sirve su línea **VPS**, no la de hosting compartido.

### Tráfico

Un evento de 2 horas con ~100 personas conectadas mueve del orden de **1 a 3 GB**. Cualquier
plan de los de arriba incluye bastante más que eso.

### Lo que no está en el hosting

Un dominio `.cl` cuesta unos **US$10-15 al año** en [NIC Chile](https://www.nic.cl). No es
obligatorio: `tu-app.fly.dev` funciona igual.

---

## Comprobaciones post-deploy

```bash
curl https://tu-dominio/api/health     # {"ok":true,...}
curl https://tu-dominio/api/stats      # lobbies, jugadores, batallas activas
```

Y la prueba que de verdad importa: **abre la app en dos teléfonos con datos móviles**
(no en el wifi de tu casa), crea un lobby en uno, únete desde el otro y haz una batalla
completa. Es la única forma de confirmar que el WebSocket pasa por el proxy del hosting.

---

## Escalar de verdad

Si algún día esto se llena y una instancia no basta, el cambio no es trivial pero está
acotado. Hay que resolver dos cosas:

1. **Difusión entre procesos** — instalar `@socket.io/redis-adapter` y conectar todas las
   instancias al mismo Redis, para que un `io.to(room).emit()` llegue a los sockets de otros
   procesos.
2. **Estado compartido** — hoy `lobbyStore` es un `Map` en memoria y es la única autoridad
   sobre el aura. Con varias instancias eso deja de funcionar. La salida más simple no es
   mover el estado a Redis, sino **enrutar por lobby**: sesiones pegajosas (*sticky sessions*)
   por código de lobby, de modo que todos los de un mismo lobby caigan siempre en el mismo
   proceso. Cada lobby es independiente de los demás, así que reparte perfecto.

Mientras tanto, una instancia sola con estos números da para mucho más de lo que necesita
una junta en una plaza.

---

## Si algo se rompe

| Síntoma | Causa casi siempre | Solución |
|---|---|---|
| "Sin conexión con el servidor" | El proxy no deja pasar el WebSocket | Habilita el upgrade en nginx, o deja que caiga a polling (ya está permitido). |
| La gente se ve en lobbies distintos con el mismo código | Más de una instancia | Bájalo a 1. |
| El aura se borra al redesplegar | Sin volumen persistente | Monta uno en `DATA_DIR`. |
| Los relojes van desfasados | Nada: se sincronizan solos | El cliente mide el desfase contra el servidor al conectar. |
| Todo lento con mucha gente | Difusión del roster | Sube `ROSTER_BROADCAST_MS`. |

Los logs del servidor dicen bastante:

```bash
fly logs                      # Fly
docker logs -f aura-farm      # Docker
journalctl -u aura-farm -f    # systemd
```
