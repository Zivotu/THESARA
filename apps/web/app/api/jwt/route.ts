
import { NextResponse } from "next/server";
import { signAppJwt, verifyAppJwt } from "@/lib/jwt-server";
import { requireJwtSecret } from "@/lib/requireEnv";

export async function POST(request: Request) {
  try {
    requireJwtSecret();
    const body = await request.json();

    if (!body || !body.token) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload. It must be a JSON object with a 'token' property." },
        { status: 400 }
      );
    }

    const { token: oldToken } = body;
    const decoded = verifyAppJwt(oldToken);

    if (!decoded || !decoded.userId) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 }
      );
    }

    const payload = {
      userId: decoded.userId,
    };

    const token = signAppJwt(payload, { expiresIn: 3600 }); // 1 hour

    return NextResponse.json({ ok: true, payload: { token } });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body." },
        { status: 400 }
      );
    }

    console.error("JWT Signing Error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
