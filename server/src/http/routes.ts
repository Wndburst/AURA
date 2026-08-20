import { Router } from 'express';
import { config, publicConfig } from '../config.js';
import { lobbyStore } from '../store/lobbyStore.js';
import { parseJoinInput } from '../util/id.js';

export function apiRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), now: Date.now() });
  });

  router.get('/config', (_req, res) => {
    res.json({ ok: true, config: publicConfig() });
  });

  router.get('/stats', (_req, res) => {
    res.json({ ok: true, ...lobbyStore.stats() });
  });

  /**
   * Chequeo previo al join: el front lo usa para validar el código antes de
   * abrir el socket, y para resolver el deep link /l/:code.
   */
  router.get('/lobbies/:code', (req, res) => {
    const ref = parseJoinInput(req.params.code);
    const lobby = ref ? lobbyStore.find(ref) : undefined;
    if (!lobby) {
      res.status(404).json({ ok: false, error: 'No existe ningún lobby con ese código.' });
      return;
    }
    res.json({
      ok: true,
      lobby: {
        id: lobby.id,
        code: lobby.code,
        name: lobby.name,
        playerCount: lobby.players.size,
        onlineCount: lobby.onlineCount(),
        hasActiveBattle: lobby.current?.status === 'ACTIVE',
      },
    });
  });

  router.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Ruta no encontrada.' });
  });

  return router;
}

export const runtimeInfo = {
  env: config.nodeEnv,
  prepMs: config.prepMs,
  battleMs: config.battleMs,
};
