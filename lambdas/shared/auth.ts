import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';

const googleJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);
const appleJwks = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys')
);

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function verifyToken(authHeader: string | undefined): Promise<{ sub: string }> {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('Missing Authorization Bearer token');

  const googleAudience =
    process.env.GOOGLE_CLIENT_ID ??
    process.env.GOOGLE_IOS_CLIENT_ID ??
    process.env.GOOGLE_ANDROID_CLIENT_ID ??
    process.env.GOOGLE_WEB_CLIENT_ID; // backwards-compat

  let iss: string;
  try {
    iss = String(decodeJwt(token).iss ?? '');
  } catch {
    throw new AuthError('Malformed token');
  }

  try {
    if (iss === 'https://accounts.google.com') {
      await jwtVerify(token, googleJwks, {
        issuer: iss,
        ...(googleAudience ? { audience: googleAudience } : {}),
      });
    } else if (iss === 'https://appleid.apple.com') {
      await jwtVerify(token, appleJwks, {
        issuer: iss,
        audience: process.env.APPLE_CLIENT_ID,
      });
    } else {
      throw new AuthError('Unknown token issuer');
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Invalid or expired token');
  }

  return { sub: String(decodeJwt(token).sub ?? '') };
}
