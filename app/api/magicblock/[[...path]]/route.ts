const MAGICBLOCK_API_URL = "https://api.docs.magicblock.app";

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const pathStr = path.length ? path.join("/") : "";
  const url = pathStr ? `${MAGICBLOCK_API_URL}/${pathStr}` : MAGICBLOCK_API_URL;

  console.log(`[MagicBlock API] GET ${url}`);

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  console.log("data", data);
  return Response.json(data, { status: res.status });
}

export async function POST(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const pathStr = path.length ? path.join("/") : "";
  const url = pathStr ? `${MAGICBLOCK_API_URL}/${pathStr}` : MAGICBLOCK_API_URL;
  const body = await request.text();

  console.log(`[MagicBlock API] POST ${url}`);
  console.log(`[MagicBlock API] Body: ${body}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[MagicBlock API] Response:`, data);
  return Response.json(data, { status: res.status });
}
