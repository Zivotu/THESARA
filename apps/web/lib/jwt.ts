import jwt from "jsonwebtoken";

export function signAppJwt(payload: any) {
  const secret = process.env.JWT_SECRET || "supersecretjwtkey";
  return jwt.sign(payload, secret, { expiresIn: "2h" });
}
