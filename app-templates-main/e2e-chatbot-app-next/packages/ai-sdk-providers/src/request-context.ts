/**
 * Utility functions for request context handling.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request context to pass user credentials through async operations
 */
export interface RequestContext {
  userAccessToken?: string;
  userEmail?: string;
}

// AsyncLocalStorage to store request context across async operations
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Set the request context for the current async operation
 */
export function setRequestContext(context: RequestContext) {
  return requestContext.enterWith(context);
}

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Run a function with a specific request context
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return requestContext.run(context, fn);
}

/**
 * Determines whether context should be injected based on endpoint type.
 *
 * Context is injected when:
 * 1. Using API_PROXY environment variable, OR
 * 2. Endpoint task type is 'agent/v2/chat' or 'agent/v1/responses'
 *
 * @param endpointTask - The task type of the serving endpoint (optional)
 * @returns Whether to inject context into requests
 */
export function shouldInjectContextForEndpoint(
  endpointTask: string | undefined,
): boolean {
  const API_PROXY = process.env.API_PROXY;

  if (API_PROXY) {
    return true;
  }

  return (
    endpointTask === 'agent/v2/chat' || endpointTask === 'agent/v1/responses'
  );
}
