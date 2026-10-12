import { notFound } from "next/navigation";
import { devReferenceDocument, isDevRouteEnabled } from "@/lib/dev-reference";
import { ColophonWorkbench } from "./ColophonWorkbench";

export const dynamic = "force-dynamic";

export default function DevColophonPage() {
  if (!isDevRouteEnabled()) notFound();
  return <ColophonWorkbench document={devReferenceDocument()} />;
}
