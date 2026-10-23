import { LANGUAGES } from "scene";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { listReferences } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const asked = new URL(request.url).searchParams.get("language");
  const language = requestLanguage(request, { language: asked });
  try {
    if (asked !== null && !(LANGUAGES as readonly string[]).includes(asked)) {
      return errorResponse("invalid_request", language);
    }
    const references = await listReferences(language);
    return Response.json(
      references.map(({ slug, subject, title, reference_level, explanation_id }) => ({
        slug,
        subject,
        title,
        reference_level,
        explanation_id,
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalError(error, language);
  }
}
