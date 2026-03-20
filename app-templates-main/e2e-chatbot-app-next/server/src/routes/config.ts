import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';

export const configRouter: RouterType = Router();

/**
 * GET /api/config - Get application configuration
 * Returns feature flags based on environment configuration
 */
configRouter.get('/', (_req: Request, res: Response) => {
  // Async polling is enabled by default to bypass proxy timeout issues
  // Set USE_ASYNC_POLLING=false to disable
  const useAsyncPolling = process.env.USE_ASYNC_POLLING !== 'false';

  // WebSocket can be enabled as alternative to async polling
  // Set USE_WEBSOCKET=true to enable (disabled by default)
  const useWebSocket = process.env.USE_WEBSOCKET === 'true';

  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
      useAsyncPolling,
      useWebSocket,
    },
  });
});
