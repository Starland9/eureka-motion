import { pingDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const database = await pingDb();
  return Response.json(
    { status: database ? "ok" : "degraded", checks: { database } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
