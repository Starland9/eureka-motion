"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Quiz as QuizDocument } from "scene";
import { usePlayback } from "@/components/player/PlaybackProvider";
import { Quiz } from "@/components/quiz/Quiz";
import { Button } from "@/components/ui/button";
import { isFullyVisible, sceneNumbersOf, scenePositionOf } from "./quiz-scenes";

interface QuizPanelProps {
  quiz: QuizDocument | null;
  explanationId: string | null;
  children: ReactNode;
}

// Another explanation starts from a clean quiz: the key drops the answers and the open state.
export function QuizPanel({ quiz, explanationId, children }: QuizPanelProps) {
  return (
    <QuizSlot key={explanationId ?? ""} quiz={quiz}>
      {children}
    </QuizSlot>
  );
}

function QuizSlot({ quiz, children }: { quiz: QuizDocument | null; children: ReactNode }) {
  const t = useTranslations("Quiz");
  const playback = usePlayback();
  const { scenes } = playback.explanation;
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<readonly string[]>([]);
  const entry = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const numbers = useMemo(() => sceneNumbersOf(scenes), [scenes]);

  useEffect(() => {
    if (open || !closing.current) return;
    closing.current = false;
    entry.current?.focus();
  }, [open]);

  function close() {
    closing.current = true;
    setOpen(false);
  }

  // The scene plays from its start; with reduced motion the player rests on its settled frame.
  function review(sceneId: string) {
    const position = scenePositionOf(scenes, sceneId);
    if (position === null) return;
    playback.seekToScene(position);
    if (!playback.reducedMotion) playback.play();
    const player = playback.playerElement();
    if (player !== null && !isFullyVisible(player.getBoundingClientRect(), window.innerHeight)) {
      player.scrollIntoView({
        block: "center",
        behavior: playback.reducedMotion ? "auto" : "smooth",
      });
    }
  }

  if (open && quiz !== null) {
    return (
      <Quiz
        quiz={quiz}
        initialAnswers={answers}
        sceneNumbers={numbers}
        focusOnOpen
        onReviewScene={review}
        onExit={close}
        onAnswersChange={setAnswers}
      />
    );
  }

  return (
    <>
      {children}
      {quiz === null ? null : (
        <div data-slot="quiz-entry" className="mt-4">
          <Button ref={entry} type="button" variant="link" onClick={() => setOpen(true)}>
            {t("open")}
          </Button>
        </div>
      )}
    </>
  );
}
