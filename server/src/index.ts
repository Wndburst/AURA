import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { apiRouter } from './http/routes.js';
import { createGateway } from './realtime/gateway.js';
import { lobbyStore } from './store/lobbyStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** dist/index.js → server/ → raíz del repo → client/dist */
const clientDist = path.resolve(__dirname, '../../client/dist');

async function main(): Promise<void> {
  await lobbyStore.init();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // El front es estático y self-contained; sin CSP estricta para no pelear
      // con los estilos inline del build de Vite.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigin.includes('*') ? true : config.corsOrigin,
    }),
  );
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', apiRouter());

  const hasClientBuild = fs.existsSync(path.join(clientDist, 'index.html'));
  if (hasClientBuild) {
    app.use(
      express.static(clientDist, {
        maxAge: '1h',
        setHeaders(res, filePath) {
          // Todo lo que Vite emite en assets/ lleva hash de contenido en el
          // nombre (`index-BUBMhMA3.js`), así que se puede cachear para siempre.
          // Se compara por ruta relativa y no con una regex sobre el path
          // absoluto: en Windows el separador es "\" y una regex con "/" no
          // engancha nunca (y el fallo es silencioso: sólo se cachea de menos).
          const relative = path.relative(clientDist, filePath);
          if (relative.startsWith(`assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('index.html')) {
            // El index nunca se cachea: es lo que apunta a los assets nuevos.
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // SPA fallback: cualquier ruta que no sea /api ni Socket.IO cae en el index.
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else if (config.isProd) {
    console.warn(`[http] no encontré el build del cliente en ${clientDist}. Corre "npm run build".`);
  }

  const server = http.createServer(app);
  const io = createGateway(server);

  // Si el puerto está ocupado hay que morir, no quedar vivo sin escuchar:
  // el handler global de uncaughtException se tragaba este error y dejaba un
  // proceso zombi que el orquestador daba por sano.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[http] el puerto ${config.port} ya está en uso. Cierra el otro proceso o cambia PORT.`);
    } else {
      console.error('[http] error del servidor:', err);
    }
    process.exit(1);
  });

  server.listen(config.port, () => {
    console.log('');
    console.log('   ☠️  AURA FARM ☠️');
    console.log(`   escuchando en http://localhost:${config.port}`);
    console.log(`   entorno: ${config.nodeEnv}${hasClientBuild ? ' · sirviendo cliente' : ''}`);
    console.log(
      `   preparación ${config.prepMs / 1000}s · batalla ${config.battleMs / 1000}s · ` +
        `${config.maxJudgmentsPerBattle || '∞'} juicios/juez`,
    );
    console.log('');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signal}] cerrando…`);

    const forced = setTimeout(() => {
      console.warn('[shutdown] cierre forzado');
      process.exit(1);
    }, 10_000);
    forced.unref?.();

    io.close();
    server.close();
    await lobbyStore.shutdown();
    clearTimeout(forced);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Una batalla con un bug no vale caerse el servidor entero: registrar y seguir.
  // Los errores de arranque, en cambio, se manejan arriba y sí terminan el proceso.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });
}

main().catch((err) => {
  console.error('No se pudo levantar el servidor:', err);
  process.exit(1);
});
