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
  opts?: { expiresIn?: string | number }
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined in environment variables.");
  }

  const options: jwt.SignOptions = {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "2h",
    ...opts,
  };

  return jwt.sign(payload, secret, options);
}