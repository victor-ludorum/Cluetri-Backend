import type { Request, Response } from '@google-cloud/functions-framework';
import { onRequest } from 'firebase-functions/v2/https';
import cors from 'cors';

// Import Function Handlers
import { analyzeSituationHandler } from './functions/analyzeSituation.js';
import { analyzeVoiceNoteHandler } from './functions/analyzeVoiceNote.js';
import { iapWebhookHandler } from './functions/iapWebhook.js';
import { liveWarRoomHandler } from './functions/liveWarRoom.js';
import { coachPayoutsHandler, markPayoutSettledHandler } from './functions/coachPayouts.js';

// =============================================================================
// CORS MIDDLEWARE CONFIGURATION
// =============================================================================
const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-appengine-country',
    'cf-ipcountry',
    'x-country-code',
    'x-admin-secret',
    'admin-secret',
    'admin_secret',
  ],
});

export function withCors(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response) => {
    return corsMiddleware(
      req as unknown as Parameters<typeof corsMiddleware>[0],
      res as unknown as Parameters<typeof corsMiddleware>[1],
      () => {
        return handler(req, res);
      }
    );
  };
}

// =============================================================================
// COMBINED MONOLITHIC ROUTER (`cluetriApi`)
// =============================================================================
export async function cluetriApiHandler(req: Request, res: Response): Promise<void> {
  const urlPath = req.path || req.url || '/';

  // Normalize path without trailing slash
  const cleanPath = urlPath.replace(/\/$/, '') || '/';

  // Healthcheck endpoint
  if (cleanPath === '/' || cleanPath === '/health') {
    res.status(200).json({
      service: 'cluetri-backend',
      version: 'v2.5.0-TACTICAL-IAP',
      billing: 'RevenueCat Native (Google Play Billing + Apple StoreKit 2)',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      endpoints: [
        'POST /iapWebhook',
        'POST /requestCoachPayout',
        'POST /markPayoutSettled',
        'POST /analyzeSituation',
        'POST /analyzeVoiceNote',
        'POST /warRoomAction',
      ],
    });
    return;
  }

  if (cleanPath === '/iapWebhook') {
    return iapWebhookHandler(req, res);
  }

  if (cleanPath === '/requestCoachPayout') {
    return coachPayoutsHandler(req, res);
  }

  if (cleanPath === '/markPayoutSettled') {
    return markPayoutSettledHandler(req, res);
  }

  if (cleanPath === '/analyzeSituation') {
    return analyzeSituationHandler(req, res);
  }

  if (cleanPath === '/analyzeVoiceNote') {
    return analyzeVoiceNoteHandler(req, res);
  }

  if (cleanPath === '/warRoomAction') {
    return liveWarRoomHandler(req, res);
  }

  res.status(404).json({
    error: 'Route not found',
    requestedPath: cleanPath,
  });
}

// =============================================================================
// FIREBASE / GCP CLOUD FUNCTIONS GEN 2 EXPORTS (us-central1)
// =============================================================================
const FUNCTION_OPTS = {
  region: 'us-central1',
  cors: true,
  maxInstances: 10,
  invoker: 'public' as const,
};

export const analyzeSituation = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(analyzeSituationHandler)(req as unknown as Request, res as unknown as Response)
);

export const analyzeVoiceNote = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(analyzeVoiceNoteHandler)(req as unknown as Request, res as unknown as Response)
);

export const iapWebhook = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(iapWebhookHandler)(req as unknown as Request, res as unknown as Response)
);

export const warRoomAction = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(liveWarRoomHandler)(req as unknown as Request, res as unknown as Response)
);

export const requestCoachPayout = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(coachPayoutsHandler)(req as unknown as Request, res as unknown as Response)
);

export const markPayoutSettled = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(markPayoutSettledHandler)(req as unknown as Request, res as unknown as Response)
);

export const cluetriApi = onRequest(FUNCTION_OPTS, (req, res) =>
  withCors(cluetriApiHandler)(req as unknown as Request, res as unknown as Response)
);

// Export raw handlers for programmatic use / unit tests
export {
  analyzeSituationHandler,
  analyzeVoiceNoteHandler,
  iapWebhookHandler,
  liveWarRoomHandler,
  coachPayoutsHandler,
  markPayoutSettledHandler,
};
