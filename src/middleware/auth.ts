import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { VerifiedSession } from '../types/index.js';

// In-memory session store (in production, use Redis)
const sessions = new Map<string, VerifiedSession>();

// Session duration: 15 minutes
const SESSION_DURATION_MS = 15 * 60 * 1000;

/**
 * Create a new verified session after successful OTP verification
 */
export function createSession(
  phoneNumber: string,
  ipAddress: string,
  userAgent: string
): string {
  // Generate secure random token
  const token = crypto.randomBytes(32).toString('hex');

  const session: VerifiedSession = {
    phoneNumber,
    verifiedAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    ipAddress,
    userAgent,
  };

  sessions.set(token, session);

  // Clean up expired sessions periodically
  cleanupExpiredSessions();

  return token;
}

/**
 * Get session by token
 */
export function getSession(token: string): VerifiedSession | null {
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  // Check if session has expired
  if (new Date() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Invalidate a session
 */
export function invalidateSession(token: string): void {
  sessions.delete(token);
}

/**
 * Express middleware to require a valid session
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const token = authHeader.slice(7);
  const session = getSession(token);

  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  // Attach session info to request for use in route handlers
  (req as any).session = session;
  (req as any).phoneNumber = session.phoneNumber;

  next();
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = new Date();

  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
