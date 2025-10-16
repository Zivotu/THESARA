import "server-only";

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === null) {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
  return value;
}

export function requireJwtSecret() {
  const secret = process.env.ROOMS_V1__JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Neither ROOMS_V1__JWT_SECRET nor JWT_SECRET is defined in environment variables.");
  }
  return secret;
}
