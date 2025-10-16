import "server-only";
import jwt from "jsonwebtoken";

/**
 * Signs a JWT with the app's secret key and adds standard claims.
 * This function is intended to run only on the server.
 *
 * @param payload The payload to sign.
 * @param opts Options for signing, like `expiresIn`.
 * @returns The signed JWT.
 */
export function signAppJwt(
  payload: object,
  opts?: { expiresIn?: number }
): string {
  const secret = process.env.ROOMS_V1__JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Neither ROOMS_V1__JWT_SECRET nor JWT_SECRET is defined in environment variables.");
  }

  const options: jwt.SignOptions = {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: 7200, // 2 hours
    ...(opts as any),
  };

  return jwt.sign(payload, secret, options);
}