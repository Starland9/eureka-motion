import {
  formatIssues,
  OutlineSchema,
  repairScene,
  SceneSchema,
  typesetTexts,
  validateOutline,
  validateScene,
  type ExplanationShape,
  type Language,
  type Level,
  type Outline,
  type Scene,
} from "scene";
import { LlmError, type GenerateRequest, type GenerateResult, type LlmRole } from "../llm";
import { EventLog, EventLogRegistry, type FinalStatus, type Verdict } from "./events";
import { pipelineMessage } from "./messages";
import {
  SHARE_RETENTION_DAYS,
  type ExplanationKind,
  type ExplanationRecord,
  type PipelineDeps,
} from "./ports";
import {
  buildCheckerPrompt,
  buildJudgePrompt,
  buildOutlinePrompt,
  buildScenePrompt,
  buildTriagePrompt,
  CheckSchema,
  JudgeSchema,
  TriageSchema,
  type Check,
  type Judgement,
  type Subject,
  type Triage,
} from "./prompts";

export interface StartInput {
  question: string;
  language: Language;
  level: Level;
  interpretation?: string | undefined;
  kind?: ExplanationKind;
}

export interface Started {
  id: string;
  cached: boolean;
  log: EventLog | null;
}

interface SceneOutcome {
  scene: Scene | null;
  verdict: Verdict;
}

interface SceneRun {
  result(index: number): Promise<SceneOutcome>;
  abort(): void;
}

interface RunContext {
  id: string;
  input: StartInput;
  shape: ExplanationShape;
  signal: AbortSignal;
}

export const SCENE_CONCURRENCY = 3;
export const MAX_PLAN_ROUNDS = 3;
export const MAX_SCENE_ROUNDS = 2;

const SIMPLER_SCENE =
  'Your previous attempts at this scene were rejected by the validation rules. Write a simpler scene that conveys the same idea: a "statement" or "figure-notes" layout, at most five elements, short texts, no "sweep" and no "move".';

const UNAVAILABLE_CODES = new Set(["unavailable", "timeout", "rate_limited"]);
const SHORT_KINDS = new Set<ExplanationKind>(["followup", "zoom"]);

function shapeOf(kind: ExplanationKind): ExplanationShape {
  return SHORT_KINDS.has(kind) ? "short" : "full";
}

export class Pipeline {
  private readonly logs: EventLogRegistry;

  constructor(
    private readonly deps: PipelineDeps,
    logs?: EventLogRegistry,
  ) {
    this.logs = logs ?? new EventLogRegistry();
  }

  logFor(id: string): EventLog | undefined {
    return this.logs.get(id);
  }

  async start(input: StartInput): Promise<Started> {
    const kind = input.kind ?? "initial";
    const key = { language: input.language, level: input.level };
    if (kind === "initial" && !input.interpretation) {
      const cachedId = await this.deps.cache.findByQuestion(input.question, key);
      if (cachedId) return { id: cachedId, cached: true, log: null };
    }

    const id = this.deps.newId();
    const record: ExplanationRecord = {
      id,
      kind,
      parent_id: null,
      root_id: id,
      focus_scene_id: null,
      question: input.question,
      language: input.language,
      level: input.level,
      concept_slug: null,
      subject: null,
      title: null,
      status: "triaging",
      payload: {
        version: 1,
        plan: null,
        params: [],
        model: { constants: [], derived: [] },
        scenes: [],
        quiz: null,
      },
      verdicts: [],
      scene_count_planned: null,
      provider: this.deps.llm.name,
      model: this.deps.llm.modelFor("author"),
      timings: {},
      created_at: this.deps.now(),
      completed_at: null,
      expires_at: null,
    };
    await this.deps.store.create(record);

    const log = this.logs.create(id);
    log.emit({ type: "accepted", explanation_id: id, cached: false });
    void this.run(record, input, log);
    return { id, cached: false, log };
  }

  private async ask<T>(label: string, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const started = Date.now();
    const rejections: string[] = [];
    const report = (ok: boolean, attempts: number): void =>
      this.deps.trace?.({
        label,
        role: request.role,
        ms: Date.now() - started,
        attempts,
        ok,
        rejections,
      });
    try {
      const result = await this.deps.llm.generateObject({
        ...request,
        onRejected: (reason) => rejections.push(reason),
      });
      report(true, result.attempts);
      return result;
    } catch (error) {
      report(false, error instanceof LlmError ? error.attempts : 1);
      throw error;
    }
  }

  private async run(record: ExplanationRecord, input: StartInput, log: EventLog): Promise<void> {
    const { deps } = this;
    const { id } = record;
    const { language, level } = input;
    const started = Date.now();
    const timings: Record<string, number> = {};
    const mark = (name: string): void => {
      timings[name] = Date.now() - started;
    };
    const controller = new AbortController();
    const kind = input.kind ?? "initial";
    const ctx: RunContext = { id, input, shape: shapeOf(kind), signal: controller.signal };

    const fail = async (code: string, message: string): Promise<void> => {
      controller.abort();
      await deps.store.update(id, { status: "failed", timings, completed_at: deps.now() });
      log.emit({ type: "error", code, message });
    };

    try {
      log.emit({ type: "step", name: "triage", status: "started" });
      const firstOutline = this.writeOutline(ctx, undefined);
      firstOutline.catch(() => undefined);
      const triage = await this.triage(ctx);
      mark("triage");
      log.emit({ type: "step", name: "triage", status: "done" });

      if (triage.decision === "refuse") {
        controller.abort();
        await deps.store.update(id, { status: "refused", timings, completed_at: deps.now() });
        log.emit({ type: "refused", reason: triage.reason });
        return;
      }
      if (triage.decision === "clarify" || !triage.concept) {
        controller.abort();
        await deps.store.update(id, {
          status: "needs_clarification",
          timings,
          completed_at: deps.now(),
        });
        log.emit({
          type: "clarify",
          reason: triage.reason,
          interpretations: triage.interpretations,
        });
        return;
      }

      const concept = triage.concept;
      if (kind === "initial") {
        const hit = await deps.cache.findByConcept(concept.slug, { language, level });
        if (hit) {
          controller.abort();
          await deps.store.remove(id);
          log.emit({ type: "cached", explanation_id: hit });
          return;
        }
      }
      await deps.store.update(id, {
        concept_slug: concept.slug,
        subject: concept.subject,
        title: concept.title,
        status: "planning",
      });
      log.emit({
        type: "meta",
        title: concept.title,
        subject: concept.subject,
        concept_slug: concept.slug,
        deep_eligible: triage.deep_eligible,
        detected_language: triage.detected_language,
      });

      log.emit({ type: "step", name: "plan", status: "started" });
      let outline: Outline | null = null;
      let judgement: Judgement | null = null;
      let judgeFallback = false;
      let scenes: SceneRun | null = null;
      let planAttempts = 0;
      let feedback: string | undefined;

      for (let round = 1; round <= MAX_PLAN_ROUNDS && !outline; round += 1) {
        const written = await (round === 1 ? firstOutline : this.writeOutline(ctx, feedback));
        planAttempts += written.attempts;
        if (round === 1) {
          mark("outline");
          log.emit({ type: "step", name: "plan", status: "done" });
          log.emit({ type: "step", name: "verify_plan", status: "started" });
        }

        const candidate = written.value;
        const speculative = this.startScenes(ctx, candidate, concept.subject);
        const judged = await this.judge(ctx, concept.title, candidate);
        judgement = judged.judgement;
        judgeFallback = judged.fallback;
        if (judgement.verdict === "valid") {
          outline = candidate;
          scenes = speculative;
        } else {
          speculative.abort();
          feedback = `An examiner rejected your previous outline. Fix every point and write the outline again.\n${judgement.issues
            .map((item) => `- ${item.where}: ${item.problem}`)
            .join("\n")}`;
        }
      }
      mark("verify_plan");
      log.emit({ type: "step", name: "verify_plan", status: "done" });

      const planChecks = [
        "structure",
        "model",
        "pedagogy",
        judgeFallback ? "accuracy:fallback" : "accuracy",
      ];
      if (!outline || !scenes) {
        const verdict: Verdict = {
          target: "plan",
          status: "dropped",
          attempts: planAttempts,
          reason: judgement?.reason ?? pipelineMessage(language, "planDropped"),
          checks: planChecks,
        };
        await deps.store.update(id, { verdicts: [verdict] });
        log.emit({ type: "verdict", ...verdict });
        await fail("plan_unverifiable", pipelineMessage(language, "failed"));
        return;
      }

      const verdicts: Verdict[] = [
        {
          target: "plan",
          status: planAttempts === 1 ? "validated" : "corrected",
          attempts: planAttempts,
          reason: judgement?.reason ?? pipelineMessage(language, "validated"),
          checks: planChecks,
        },
      ];
      const payload = {
        version: 1 as const,
        plan: outline.plan,
        params: outline.params,
        model: outline.model,
        scenes: [] as Scene[],
        quiz: null as ExplanationRecord["payload"]["quiz"],
      };
      const count = outline.plan.steps.length;
      await deps.store.update(id, {
        payload,
        verdicts,
        scene_count_planned: count,
        status: "streaming",
      });
      log.emit({ type: "verdict", ...(verdicts[0] as Verdict) });
      log.emit({
        type: "plan",
        plan: outline.plan,
        params: outline.params,
        model: outline.model,
        scene_count: count,
      });

      log.emit({ type: "step", name: "scenes", status: "started" });
      let dropped = 0;
      for (let index = 0; index < count; index += 1) {
        const outcome = await scenes.result(index);
        verdicts.push(outcome.verdict);
        log.emit({ type: "verdict", ...outcome.verdict });
        if (outcome.scene) {
          payload.scenes.push(outcome.scene);
          if (timings.first_scene === undefined) mark("first_scene");
          log.emit({ type: "scene", index, scene: outcome.scene });
        } else {
          dropped += 1;
          log.emit({ type: "scene_dropped", index });
        }
        await deps.store.update(id, { payload, verdicts });
      }
      mark("scenes");
      log.emit({ type: "step", name: "scenes", status: "done" });

      if (payload.scenes.length === 0) {
        await fail("generation_failed", pipelineMessage(language, "failed"));
        return;
      }

      if (deps.writeQuiz && ctx.shape === "full") {
        log.emit({ type: "step", name: "quiz", status: "started" });
        const quiz = await deps
          .writeQuiz({ outline, scenes: payload.scenes, language, level, traceId: id })
          .catch(() => null);
        if (quiz) {
          payload.quiz = quiz;
          log.emit({ type: "quiz", quiz });
        }
        mark("quiz");
        log.emit({ type: "step", name: "quiz", status: "done" });
      }

      const status: FinalStatus = dropped === 0 ? "ready" : "partial";
      const completed = deps.now();
      mark("total");
      await deps.store.update(id, {
        payload,
        verdicts,
        status,
        timings,
        completed_at: completed,
        expires_at: new Date(completed.getTime() + SHARE_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      });
      if (status === "ready" && kind === "initial") {
        await deps.cache.remember(id, {
          question: input.interpretation ?? input.question,
          slug: concept.slug,
          language,
          level,
        });
      }
      if (triage.deep_eligible && deps.enqueueDeep && status === "ready") {
        await deps.enqueueDeep(id).then(
          () => log.emit({ type: "deep", status: "queued" }),
          () => undefined,
        );
      }
      log.emit({ type: "done", status, share_url: deps.shareUrl(id, language) });
    } catch (error) {
      const unavailable = error instanceof LlmError && UNAVAILABLE_CODES.has(error.code);
      await fail(
        unavailable ? "generation_unavailable" : "generation_failed",
        pipelineMessage(language, unavailable ? "unavailable" : "failed"),
      ).catch(() => undefined);
    }
  }

  private async triage(ctx: RunContext): Promise<Triage> {
    const { input } = ctx;
    const result = await this.ask("triage", {
      role: "triage",
      ...buildTriagePrompt({
        question: input.question,
        language: input.language,
        level: input.level,
        interpretation: input.interpretation,
      }),
      schema: TriageSchema,
      validate: (value) => {
        if (value.decision === "accept" && !value.concept)
          return 'decision "accept" needs "concept"';
        if (value.decision === "clarify" && value.interpretations.length < 2) {
          return 'decision "clarify" needs 2 or 3 "interpretations"';
        }
        if (value.decision !== "accept" && value.reason.trim() === "") {
          return `decision "${value.decision}" needs a "reason" for the student`;
        }
        return null;
      },
      traceId: ctx.id,
      signal: ctx.signal,
    });
    return result.value;
  }

  private writeOutline(
    ctx: RunContext,
    feedback: string | undefined,
  ): Promise<GenerateResult<Outline>> {
    const { input, shape } = ctx;
    return this.ask("outline", {
      role: "author",
      ...buildOutlinePrompt({
        question: input.interpretation ?? input.question,
        language: input.language,
        level: input.level,
        shape,
        extra: feedback,
      }),
      schema: OutlineSchema,
      validate: (value) => {
        const result = validateOutline(value, { shape });
        if (!result.ok) return formatIssues(result.issues);
        Object.assign(value, typesetTexts(value, input.language));
        return null;
      },
      traceId: ctx.id,
      signal: ctx.signal,
    });
  }

  private async judge(
    ctx: RunContext,
    title: string,
    outline: Outline,
  ): Promise<{ judgement: Judgement; fallback: boolean }> {
    const prompt = buildJudgePrompt({
      title,
      outline,
      language: ctx.input.language,
      level: ctx.input.level,
    });
    const ask = async (role: LlmRole): Promise<Judgement> =>
      (
        await this.ask("judge", {
          role,
          ...prompt,
          schema: JudgeSchema,
          traceId: ctx.id,
          signal: ctx.signal,
        })
      ).value;
    try {
      return { judgement: await ask("judge"), fallback: false };
    } catch (error) {
      if (!(error instanceof LlmError) || ctx.signal.aborted) throw error;
      return { judgement: await ask("checker"), fallback: true };
    }
  }

  private startScenes(ctx: RunContext, outline: Outline, subject: Subject): SceneRun {
    const controller = new AbortController();
    const signal = AbortSignal.any([ctx.signal, controller.signal]);
    const count = outline.plan.steps.length;
    const results: Promise<SceneOutcome>[] = [];
    let active = 0;
    const waiting: (() => void)[] = [];

    const acquire = async (): Promise<void> => {
      if (active < SCENE_CONCURRENCY) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    };
    const release = (): void => {
      const resume = waiting.shift();
      if (resume) resume();
      else active -= 1;
    };

    for (let index = 0; index < count; index += 1) {
      const task = (async (): Promise<SceneOutcome> => {
        await acquire();
        try {
          return await this.writeScene(ctx, outline, subject, index, signal);
        } finally {
          release();
        }
      })();
      task.catch(() => undefined);
      results.push(task);
    }

    return {
      result: (index) => results[index] as Promise<SceneOutcome>,
      abort: () => controller.abort(),
    };
  }

  private async writeScene(
    ctx: RunContext,
    outline: Outline,
    subject: Subject,
    index: number,
    signal: AbortSignal,
  ): Promise<SceneOutcome> {
    const { language, level } = ctx.input;
    const target = `s${index + 1}`;
    const checks = ["structure", "references", "model", "readability", "framing", "pedagogy"];
    let attempts = 0;
    let extra: string | undefined;
    let reason = pipelineMessage(language, "dropped");

    const drop = (): SceneOutcome => ({
      scene: null,
      verdict: { target, status: "dropped", attempts: Math.max(1, attempts), reason, checks },
    });

    for (let round = 1; round <= MAX_SCENE_ROUNDS; round += 1) {
      let scene: Scene;
      try {
        const written = await this.ask(`scene ${index}`, {
          role: "author",
          ...buildScenePrompt({ outline, index, subject, language, level, extra }),
          schema: SceneSchema,
          validate: (value) => {
            value.id = target;
            value.index = index;
            Object.assign(value, repairScene(value, outline));
            const result = validateScene(value, outline);
            if (!result.ok) return formatIssues(result.issues);
            Object.assign(value, typesetTexts(value, language));
            return null;
          },
          traceId: ctx.id,
          signal,
        });
        attempts += written.attempts;
        scene = written.value;
      } catch (error) {
        if (signal.aborted) throw error;
        if (!(error instanceof LlmError)) throw error;
        attempts += error.attempts;
        if (error.code !== "invalid_output" || round === MAX_SCENE_ROUNDS) return drop();
        extra = SIMPLER_SCENE;
        continue;
      }

      let check: Check;
      try {
        check = (
          await this.ask(`check ${index}`, {
            role: "checker",
            ...buildCheckerPrompt({ outline, scene, language, level }),
            schema: CheckSchema,
            traceId: ctx.id,
            signal,
          })
        ).value;
      } catch (error) {
        if (signal.aborted || !(error instanceof LlmError)) throw error;
        return drop();
      }

      if (check.verdict === "valid") {
        const narrated = await this.deps.voice.narrate(ctx.id, scene, language).catch(() => scene);
        return {
          scene: narrated,
          verdict: {
            target,
            status: attempts === 1 ? "validated" : "corrected",
            attempts,
            reason: check.reason,
            checks: [...checks, "accuracy"],
          },
        };
      }
      reason = check.reason;
      extra = `A reviewer rejected your previous version of this scene. Fix this and write the scene again.\n${check.problem}`;
    }
    return drop();
  }
}
