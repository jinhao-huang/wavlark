import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

const keySets = new Map();

export async function verifyPublisher(token, issuer, audience) {
  if (!keySets.has(issuer)) {
    keySets.set(issuer, createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)));
  }
  try {
    const { payload } = await jwtVerify(token, keySets.get(issuer), {
      algorithms: ['RS256'], issuer, audience, requiredClaims: ['exp']
    });
    return payload.type === 'app' ? payload : null;
  } catch (error) {
    if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired ||
        error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid ||
        error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JOSENotSupported ||
        error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys) {
      return null;
    }
    throw error;
  }
}
