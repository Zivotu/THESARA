// PATCH PROMPT: Fix JWT signing route in Next.js (apps/web/app/api/jwt/route.ts)
// Context: Currently returns "Invalid payload" because it expects { token }.
// Goal: Make this route generate a signed JWT token from provided JSON (e.g. { userId, role }).

import jwt from 'jsonwebtoken'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Allow any object (userId optional)
    const payload =
      typeof body === 'object' && body !== null ? body : { anon: true }

    // Validate secret
    const secret = process.env.JWT_SECRET
    if (!secret) {
      return Response.json({ ok: false, error: 'Missing JWT_SECRET' }, { status: 500 })
    }

    // Sign a new JWT (HS256)
    const token = jwt.sign(payload, secret, {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: 'thesara-web',
    })

    return Response.json({ ok: true, token })
  } catch (err: any) {
    console.error('JWT signing failed:', err)
    return Response.json({ ok: false, error: err.message || 'Failed to sign token' }, { status: 400 })
  }
}