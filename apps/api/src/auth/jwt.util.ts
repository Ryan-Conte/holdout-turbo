import * as jwt from 'jsonwebtoken';

export interface AuthClaims {
  sub: string; // Better Auth user id
  username: string;
  serverUrl?: string;
  guest: boolean;
}

export function verifyToken(token: string): AuthClaims | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || typeof payload.username !== 'string') return null;
    const guest = payload.guest === true;
    if (guest) {
      if (!/^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
      if (!/^Guest-[A-F0-9]{6}$/.test(payload.username)) return null;
    } else if (payload.sub.startsWith('guest:')) {
      return null;
    }
    return {
      sub: payload.sub,
      username: payload.username,
      guest,
      ...(typeof payload.serverUrl === 'string' ? { serverUrl: payload.serverUrl } : {}),
    };
  } catch {
    return null;
  }
}
