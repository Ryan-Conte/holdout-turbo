import * as jwt from 'jsonwebtoken';

export interface AuthClaims {
  sub: string; // Better Auth user id
  username: string;
}

export function verifyToken(token: string): AuthClaims | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || typeof payload.username !== 'string') return null;
    return { sub: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}
