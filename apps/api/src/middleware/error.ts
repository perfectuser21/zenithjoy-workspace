import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors
      }
    });
  }

  // Custom API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // PostgreSQL unique constraint violation
  if ((err as any).code === '23505') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Resource already exists',
        details: (err as any).detail
      }
    });
  }

  // PostgreSQL foreign key violation
  if ((err as any).code === '23503') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Referenced resource does not exist',
        details: (err as any).detail
      }
    });
  }

  // Log internal errors
  console.error('Internal error:', err);

  // Generic internal error
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    }
  });
}

// Not found handler
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    }
  });
}
