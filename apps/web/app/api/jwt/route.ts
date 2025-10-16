
import { NextResponse } from "next/server";
import { signAppJwt } from "@/lib/jwt-server"; // Assuming '@' is aliased to 'apps/web'
import { requireJwtSecret } from "@/lib/requireEnv";

export async function POST(request: Request) {
  try {
    requireJwtSecret();
    const payload = await request.json();

    // Basic validation to ensure payload contains a userId
    if (!payload || typeof payload !== 'object' || !('userId' in payload)) {
      return NextResponse.json(
        { error: "Invalid payload. It must be a JSON object with a 'userId' property." },
        { status: 400 }
      );
    }

    const token = signAppJwt(payload, { expiresIn: 3600 }); // 1 hour

    return NextResponse.json({ token });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400 }
      );
    }
    
    console.error("JWT Signing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", message: error.message },
      { status: 500 }
    );
  }
}
