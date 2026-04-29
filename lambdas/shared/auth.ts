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

  // Accept any of the configured Google audiences. Google issues ID tokens with
  // aud = the client ID that requested them, so iOS / Android / Web each get a
  // different audience even though they're the same OAuth project.
  const googleAudiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ].filter((v): v is string => Boolean(v));

  let iss: string;
  try {
    iss = String(decodeJwt(token).iss ?? '');
  } catch {
    throw new AuthError('Malformed token');
  }

  // Decode payload up front for diagnostic logging (does NOT validate)
  const payload = decodeJwt(token);
  console.log('[auth] verifying token', {
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
    expDelta: payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : null,
    expectedGoogleAuds: googleAudiences,
    expectedAppleAud: process.env.APPLE_CLIENT_ID,
  });

  try {
    if (iss === 'https://accounts.google.com') {
      await jwtVerify(token, googleJwks, {
        issuer: iss,
        // jose accepts a string[] for audience — passes if the token's aud matches any
        ...(googleAudiences.length > 0 ? { audience: googleAudiences } : {}),
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
    const errCode = (e as { code?: string }).code ?? 'unknown';
    const errMsg = (e as { message?: string }).message ?? 'unknown';
    console.warn('[auth] jwt verify failed', { errCode, errMsg, iss: payload.iss, aud: payload.aud });
    throw new AuthError(`Invalid or expired token (${errCode})`);
  }

  return { sub: String(decodeJwt(token).sub ?? '') };
}
