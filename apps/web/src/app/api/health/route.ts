import { checkHealth } from "@/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await checkHealth(), { headers: { "Cache-Control": "no-store" } });
}
