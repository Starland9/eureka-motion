import { notFound } from "next/navigation";
import { DocumentSchema } from "scene";
import reference from "../../../../../../../content/reference/physics.universal-gravitation.fr.json";
import { PlancheProto } from "./PlancheProto";

export const dynamic = "force-dynamic";

export default function ProtoPlanchePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PlancheProto document={DocumentSchema.parse(reference.payload)} />;
}
