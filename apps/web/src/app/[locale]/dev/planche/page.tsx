import { notFound } from "next/navigation";
import { devReferenceDocument, isDevRouteEnabled } from "@/lib/dev-reference";
import { PlancheWorkbench } from "./PlancheWorkbench";

export const dynamic = "force-dynamic";

export default function DevPlanchePage() {
  if (!isDevRouteEnabled()) notFound();
  return <PlancheWorkbench document={devReferenceDocument()} />;
}
