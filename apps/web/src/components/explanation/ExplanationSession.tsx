"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useExplanationStream } from "@/components/player/useExplanationStream";
import type { ExplanationStream } from "./types";

const SessionContext = createContext<ExplanationStream | null>(null);

export function ExplanationSessionProvider({ children }: { children: ReactNode }) {
  const stream = useExplanationStream();
  return <SessionContext.Provider value={stream}>{children}</SessionContext.Provider>;
}

export function useExplanationSession(): ExplanationStream {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useExplanationSession must be used inside its provider");
  return session;
}
