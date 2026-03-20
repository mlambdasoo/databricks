import type { Request, Response, NextFunction } from 'express';
import { getAuthSession, type AuthSession } from '@chat-template/auth';
import { checkChatAccess } from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';

// Extend Express Request type to include session and OBO token
declare global {
  namespace Express {
    interface Request {
      session?: AuthSession;
      userAccessToken?: string;
      userEmail?: string;
    }
  }
}

/**
 * Middleware to authenticate requests and attach session to request object
 * Also extracts user's access token for OBO (On-Behalf-Of) operations
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    // Debug: Log all x-forwarded and authorization headers for OBO troubleshooting
    const relevantHeaders = Object.entries(req.headers)
      .filter(([key]) =>
        key.toLowerCase().startsWith('x-forwarded') ||
        key.toLowerCase().startsWith('x-databricks') ||
        key.toLowerCase() === 'authorization'
      )
      .map(([key, value]) => {
        // Mask token values for security
        const val = String(value);
        if (key.toLowerCase().includes('token') || key.toLowerCase() === 'authorization') {
          return `${key}: ${val.length > 20 ? `${val.substring(0, 10)}...${val.substring(val.length - 10)} (len=${val.length})` : '***SHORT***'}`;
        }
        return `${key}: ${val}`;
      });
    console.log('[Auth Debug] Relevant headers:', relevantHeaders.length > 0 ? relevantHeaders.join(', ') : 'NONE');

    const session = await getAuthSession({
      getRequestHeader: (name: string) =>
        req.headers[name.toLowerCase()] as string | null,
    });
    req.session = session || undefined;

    // Extract user's access token and email for OBO operations
    // These headers are provided by Databricks Apps when OBO is enabled
    // Using req.header() as recommended by Express docs (case-insensitive)
    // Try multiple possible header names for the user access token
    const userAccessToken =
      req.header('x-forwarded-access-token') ||
      req.header('x-databricks-user-access-token') ||
      req.header('x-databricks-access-token');
    const userEmail = req.header('x-forwarded-email');

    if (userAccessToken) {
      req.userAccessToken = userAccessToken;
      req.userEmail = userEmail;
      const tokenPreview = userAccessToken.length > 20
        ? `${userAccessToken.substring(0, 10)}...${userAccessToken.substring(userAccessToken.length - 10)}`
        : '***SHORT***';
      console.log(`[Auth] User access token received for OBO operations - Token: ${tokenPreview}, Length: ${userAccessToken.length}, Email: ${userEmail}`);
    } else {
      console.log('[Auth] No X-Forwarded-Access-Token header found (not using OBO)');
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    next(error);
  }
}

/**
 * Middleware to require authentication - returns 401 if no session
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    const response = new ChatSDKError('unauthorized:chat').toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}

export async function requireChatAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const id = getIdFromRequest(req);
  if (!id) {
    console.error(
      'Chat access middleware error: no chat ID provided',
      req.params,
    );
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  const { allowed, reason } = await checkChatAccess(id, req.session?.user.id);
  if (!allowed) {
    console.error(
      'Chat access middleware error: user does not have access to chat',
      reason,
    );
    const error = new ChatSDKError('forbidden:chat', reason);
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}

export const getIdFromRequest = (req: Request): string | undefined => {
  const { id } = req.params;
  if (!id) return undefined;
  return typeof id === 'string' ? id : id[0];
};