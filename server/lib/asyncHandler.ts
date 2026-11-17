import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRouteFn = (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>;

/**
 * Wraps an async Express 4 route handler or middleware so rejected promises
 * are forwarded cleanly to Express's global error handler.
 */
export function asyncHandler(fn: AsyncRouteFn): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
