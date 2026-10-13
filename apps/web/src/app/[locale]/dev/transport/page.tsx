import { notFound } from "next/navigation";
import { devReferenceDocument, isDevRouteEnabled } from "@/lib/dev-reference";
import { TransportWorkbench } from "./TransportWorkbench";

export const dynamic = "force-dynamic";

export default function DevTransportPage() {
  if (!isDevRouteEnabled()) notFound();
  return <TransportWorkbench document={devReferenceDocument()} />;
}
