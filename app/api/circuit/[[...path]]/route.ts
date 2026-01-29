import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const CIRCUIT_DIR = path.join(
  process.cwd(),
  "node_modules",
  "privacycash",
  "circuit2",
);

const ALLOWED = new Set(["transaction2.wasm", "transaction2.zkey"]);
const MIME: Record<string, string> = {
  ".wasm": "application/wasm",
  ".zkey": "application/octet-stream",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const resolved = await params;
  const file = resolved.path?.join("/");
  if (!file || !ALLOWED.has(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const filePath = path.join(CIRCUIT_DIR, file);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Circuit file not found" },
      { status: 404 },
    );
  }
  const ext = path.extname(file);
  const contentType = MIME[ext] ?? "application/octet-stream";
  const body = fs.readFileSync(filePath);
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
