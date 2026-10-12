import { notFound } from "next/navigation";
import { devReferenceDocument, isDevRouteEnabled } from "@/lib/dev-reference";
import { ScenesWorkbench } from "./ScenesWorkbench";

export const dynamic = "force-dynamic";

export default function DevScenesPage() {
  if (!isDevRouteEnabled()) notFound();
  return <ScenesWorkbench document={devReferenceDocument()} />;
}
