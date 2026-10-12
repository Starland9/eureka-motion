import { notFound } from "next/navigation";
import { DocumentSchema } from "scene";
import reference from "../../../../../../../content/reference/physics.universal-gravitation.fr.json";
import { GrowingPlayer } from "./GrowingPlayer";

export const dynamic = "force-dynamic";

export default function ProtoPlayerPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const document = DocumentSchema.parse(reference.payload);
  return <GrowingPlayer document={document} />;
}
