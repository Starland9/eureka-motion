import {
  formatIssues,
  OutlineSchema,
  repairOutline,
  repairScene,
  SceneSchema,
  typeset,
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
  buildFollowupCheckPrompt,
  buildJudgePrompt,
  buildModeOutlinePrompt,
  buildModeScenePrompt,
  buildOutlinePrompt,
  buildScenePrompt,
  buildTriagePrompt,
  CheckSchema,
  checkModeOutline,
  FollowupCheckSchema,
  JudgeSchema,
  MODE_SHAPE,
  modeLevel,
  sameAnalogy,
  TriageSchema,
  type Analogy,
  type Check,
  type FollowupCheck,
  type Judgement,
  type ModeTask,
  type ParentContext,
  type Subject,
  type Triage,
} from "./prompts";
import { isPlayable } from "./replay";

export interface StartInput {
  mode?: "initial";
  question: string;
  language: Language;
  level: Level;
  interpretation?: string | undefined;
}

export interface ReformulationInput {
  mode: "another_analogy" | "simpler";
  parent_id: string;
  language: Language;
  level: Level;
}

export interface ZoomInput {
  mode: "zoom";
  parent_id: string;
  scene_id: string;
  language: Language;
  level: Level;
}

export interface FollowupInput {
  mode: "followup";
  parent_id: string;
  question: string;
  language: Language;
  level: Level;
}

export type ModeInput = ReformulationInput | ZoomInput | FollowupInput;
export type PipelineRequest = StartInput | ModeInput;

export class ParentNotFoundError extends Error {
  readonly code = "parent_not_found";

  constructor(message: string) {
    super(message);
    this.name = "ParentNotFoundError";
  }
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

interface Lineage {
  request: ModeInput;
  parent: ExplanationRecord;
  context: ParentContext;
}

interface RunContext {
  id: string;
  kind: ExplanationKind;
  question: string;
  interpretation: string | undefined;
  language: Language;
  level: Level;
  shape: ExplanationShape;
  signal: AbortSignal;
  task: ModeTask | null;
}

type Concept = NonNullable<Triage["concept"]>;

type Triaged =
  | { decision: "refuse"; reason: string }
  | { decision: "clarify"; reason: string; interpretations: Triage["interpretations"] }
  | {
      decision: "accept";
      concept: Concept;
      deepEligible: boolean;
      detectedLanguage: Language | "other";
      firstOutline: Promise<GenerateResult<Outline>>;
    };

type RecordOrigin = Pick<
  ExplanationRecord,
  "kind" | "parent_id" | "root_id" | "focus_scene_id" | "question" | "language" | "level"
>;

export const SCENE_CONCURRENCY = 3;
export const MAX_PLAN_ROUNDS = 3;
export const MAX_SCENE_ROUNDS = 2;
const MAX_SESSION_VERSIONS = 50;

const SIMPLER_SCENE =
  'Your previous attempts at this scene were rejected by the validation rules. Write a simpler scene that conveys the same idea: a "statement" or "figure-notes" layout, at most five elements, short texts, no "sweep" and no "move".';

const UNAVAILABLE_CODES = new Set(["unavailable", "timeout", "rate_limited"]);
const DEEP_SUBJECTS: ReadonlySet<Subject> = new Set(["maths", "physics"]);
const REFORMULATIONS = new Set<ExplanationKind>(["another_analogy", "simpler", "zoom"]);

function isQuestion(input: PipelineRequest): input is StartInput {
  return input.mode === undefined || input.mode === "initial";
}

function shapeOf(kind: ExplanationKind): ExplanationShape {
  return kind === "initial" || kind === "reference" ? "full" : MODE_SHAPE[kind];
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

  async start(input: PipelineRequest): Promise<Started> {
    return isQuestion(input) ? this.startQuestion(input) : this.startFrom(input);
  }

  private async startQuestion(input: StartInput): Promise<Started> {
    const key = { language: input.language, level: input.level };
    if (!input.interpretation) {
      const cachedId = await this.deps.cache.findByQuestion(input.question, key);
      if (cachedId) return { id: cachedId, cached: true, log: null };
    }
    const id = this.deps.newId();
    const origin: RecordOrigin = {
      kind: "initial",
      parent_id: null,
      root_id: id,
      focus_scene_id: null,
      question: input.question,
      language: input.language,
      level: input.level,
    };
    return this.launch(id, origin, input.interpretation, null);
  }

  private async startFrom(input: ModeInput): Promise<Started> {
    const parent = await this.findRecord(input.parent_id);
    const plan = parent?.payload.plan;
    if (!parent || !plan || !isPlayable(parent)) {
      throw new ParentNotFoundError(`No playable explanation ${input.parent_id}`);
    }
    if (input.mode === "zoom" && !parent.payload.scenes.some(({ id }) => id === input.scene_id)) {
      throw new ParentNotFoundError(`Explanation ${parent.id} has no scene ${input.scene_id}`);
    }
    if (parent.kind === "reference") await this.keepReference(parent);

    const context: ParentContext = {
      title: parent.title ?? "",
      slug: parent.concept_slug ?? "",
      level: parent.level,
      outline: { plan, params: parent.payload.params, model: parent.payload.model },
      scenes: parent.payload.scenes,
    };
    const origin: RecordOrigin = {
      kind: input.mode,
      parent_id: parent.id,
      root_id: parent.root_id,
      focus_scene_id: input.mode === "zoom" ? input.scene_id : null,
      question: input.mode === "followup" ? input.question : parent.question,
      language: parent.language,
      level: modeLevel(input.mode, input.level, parent.level),
    };
    return this.launch(this.deps.newId(), origin, undefined, { request: input, parent, context });
  }

  private async launch(
    id: string,
    origin: RecordOrigin,
    interpretation: string | undefined,
    lineage: Lineage | null,
  ): Promise<Started> {
    const record: ExplanationRecord = {
      id,
      ...origin,
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
    void this.run(record, interpretation, lineage, log);
    return { id, cached: false, log };
  }

  private async findRecord(id: string): Promise<ExplanationRecord | null> {
    return (await this.deps.findReference?.(id)) ?? (await this.deps.store.get(id));
  }

  // A new version points at its parent and root rows; reference explanations have none until then.
  private async keepReference(record: ExplanationRecord): Promise<void> {
    const { store } = this.deps;
    if (await store.get(record.id)) return;
    try {
      await store.create(record);
    } catch (error) {
      if (!(await store.get(record.id))) throw error;
    }
  }

  private async sessionAnalogies(parent: ExplanationRecord): Promise<Analogy[]> {
    const found: Analogy[] = [];
    const seen = new Set<string>();
    let current: ExplanationRecord | null = parent;
    while (current && !seen.has(current.id) && seen.size < MAX_SESSION_VERSIONS) {
      seen.add(current.id);
      const analogy = current.payload.plan?.analogy;
      if (analogy && !found.some((known) => sameAnalogy(known.name, analogy.name))) {
        found.push(analogy);
      }
      current = current.parent_id ? await this.findRecord(current.parent_id) : null;
    }
    return found;
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

  private async run(
    record: ExplanationRecord,
    interpretation: string | undefined,
    lineage: Lineage | null,
    log: EventLog,
  ): Promise<void> {
    const { deps } = this;
    const { id } = record;
    const started = Date.now();
    const timings: Record<string, number> = {};
    const mark = (name: string): void => {
      timings[name] = Date.now() - started;
    };
    const controller = new AbortController();
    let ctx: RunContext = {
      id,
      kind: record.kind,
      question: record.question,
      interpretation,
      language: record.language,
      level: record.level,
      shape: shapeOf(record.kind),
      signal: controller.signal,
      task: null,
    };
    const failed = (): string =>
      pipelineMessage(ctx.language, REFORMULATIONS.has(ctx.kind) ? "versionFailed" : "failed");

    const fail = async (code: string, message: string): Promise<void> => {
      controller.abort();
      await deps.store.update(id, { status: "failed", timings, completed_at: deps.now() });
      log.emit({ type: "error", code, message });
    };

    try {
      log.emit({ type: "step", name: "triage", status: "started" });
      const admitted = await this.admit(ctx, lineage, log);
      ctx = admitted.ctx;
      const { triaged } = admitted;
      const { language, level } = ctx;
      mark("triage");
      log.emit({ type: "step", name: "triage", status: "done" });

      if (triaged.decision === "refuse") {
        controller.abort();
        await deps.store.update(id, { status: "refused", timings, completed_at: deps.now() });
        log.emit({ type: "refused", reason: triaged.reason });
        return;
      }
      if (triaged.decision === "clarify") {
        controller.abort();
        await deps.store.update(id, {
          status: "needs_clarification",
          timings,
          completed_at: deps.now(),
        });
        log.emit({
          type: "clarify",
          reason: triaged.reason,
          interpretations: triaged.interpretations,
        });
        return;
      }

      const { concept } = triaged;
      if (ctx.kind === "initial") {
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
        deep_eligible: triaged.deepEligible,
        detected_language: triaged.detectedLanguage,
      });

      log.emit({ type: "step", name: "plan", status: "started" });
      let outline: Outline | null = null;
      let judgement: Judgement | null = null;
      let judgeFallback = false;
      let scenes: SceneRun | null = null;
      let planAttempts = 0;
      let feedback: string | undefined;

      for (let round = 1; round <= MAX_PLAN_ROUNDS && !outline; round += 1) {
        const written = await (round === 1
          ? triaged.firstOutline
          : this.writeOutline(ctx, feedback));
        planAttempts += written.attempts;
        if (round === 1) {
          mark("outline");
          log.emit({ type: "step", name: "plan", status: "done" });
          log.emit({ type: "step", name: "verify_plan", status: "started" });
        }

        const candidate = written.value;
        const speculative = this.startScenes(ctx, candidate, concept.subject);
        const judged = await this.judge(ctx, ctx.task?.parent.title || concept.title, candidate);
        judgement = judged.judgement;
        judgeFallback = judged.fallback;
        if (judgement.verdict === "valid") {
          outline = candidate;
          scenes = speculative;
        } else {
          speculative.abort();
          const issues = judgement.issues.map((item) => `- ${item.where}: ${item.problem}`);
          this.deps.trace?.({
            label: "plan refused",
            role: "judge",
            ms: 0,
            attempts: round,
            ok: false,
            rejections: issues,
          });
          feedback = `An examiner rejected your previous outline. Fix every point and write the outline again.\n${issues.join("\n")}`;
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
        await fail("plan_unverifiable", failed());
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
        await fail("generation_failed", failed());
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
      if (status === "ready" && ctx.kind === "initial") {
        await deps.cache.remember(id, {
          question: ctx.interpretation ?? ctx.question,
          slug: concept.slug,
          language,
          level,
        });
      }
      if (triaged.deepEligible && ctx.kind === "initial" && (await this.queueDeep(id))) {
        log.emit({ type: "deep", status: "queued" });
      }
      log.emit({ type: "done", status, share_url: deps.shareUrl(id, language) });
    } catch (error) {
      const unavailable = error instanceof LlmError && UNAVAILABLE_CODES.has(error.code);
      await fail(
        unavailable ? "generation_unavailable" : "generation_failed",
        unavailable ? pipelineMessage(ctx.language, "unavailable") : failed(),
      ).catch(() => undefined);
    }
  }

  // The immediate explanation never depends on the deep version: a failure is only logged.
  private async queueDeep(id: string): Promise<boolean> {
    const { enqueueDeep } = this.deps;
    if (!enqueueDeep) return false;
    try {
      return (await enqueueDeep(id)) !== false;
    } catch (error) {
      console.error(`The deep version of explanation ${id} could not be queued.`, error);
      return false;
    }
  }

  private async admit(
    ctx: RunContext,
    lineage: Lineage | null,
    log: EventLog,
  ): Promise<{ ctx: RunContext; triaged: Triaged }> {
    if (!lineage) return { ctx, triaged: await this.triageQuestion(ctx) };

    const { request, parent, context } = lineage;
    const concept: Concept = {
      slug: context.slug,
      title: context.title,
      subject: parent.subject ?? "other",
    };

    if (request.mode === "followup") {
      const asking: RunContext = {
        ...ctx,
        task: { mode: "followup", parent: context, question: request.question },
      };
      const speculative = new AbortController();
      const outline = this.writeOutline(
        asking,
        undefined,
        AbortSignal.any([ctx.signal, speculative.signal]),
      );
      outline.catch(() => undefined);
      const check = await this.checkFollowup(asking, context, request.question);
      if (check.related) {
        return {
          ctx: asking,
          triaged: {
            decision: "accept",
            concept: { ...concept, title: check.title || concept.title },
            deepEligible: false,
            detectedLanguage: check.detected_language,
            firstOutline: outline,
          },
        };
      }
      speculative.abort();
      const fresh = await this.redirect(ctx, request);
      log.emit({ type: "redirected", reason: "unrelated_followup" });
      return { ctx: fresh, triaged: await this.triageQuestion(fresh) };
    }

    const task: ModeTask =
      request.mode === "zoom"
        ? { mode: "zoom", parent: context, focus: request.scene_id }
        : { mode: request.mode, parent: context, analogies: await this.sessionAnalogies(parent) };
    const next: RunContext = { ...ctx, task };
    const firstOutline = this.writeOutline(next, undefined);
    firstOutline.catch(() => undefined);
    return {
      ctx: next,
      triaged: {
        decision: "accept",
        concept,
        deepEligible: false,
        detectedLanguage: parent.language,
        firstOutline,
      },
    };
  }

  private async triageQuestion(ctx: RunContext): Promise<Triaged> {
    const firstOutline = this.writeOutline(ctx, undefined);
    firstOutline.catch(() => undefined);
    const triage = await this.triage(ctx);
    if (triage.decision === "refuse") return { decision: "refuse", reason: triage.reason };
    if (triage.decision === "clarify" || !triage.concept) {
      return {
        decision: "clarify",
        reason: triage.reason,
        interpretations: triage.interpretations,
      };
    }
    return {
      decision: "accept",
      concept: triage.concept,
      deepEligible: triage.deep_eligible && DEEP_SUBJECTS.has(triage.concept.subject),
      detectedLanguage: triage.detected_language,
      firstOutline,
    };
  }

  private async redirect(ctx: RunContext, request: FollowupInput): Promise<RunContext> {
    const { question, language, level } = request;
    await this.deps.store.update(ctx.id, {
      kind: "initial",
      parent_id: null,
      root_id: ctx.id,
      focus_scene_id: null,
      question,
      language,
      level,
    });
    return {
      ...ctx,
      kind: "initial",
      question,
      interpretation: undefined,
      language,
      level,
      shape: "full",
      task: null,
    };
  }

  private async triage(ctx: RunContext): Promise<Triage> {
    const result = await this.ask("triage", {
      role: "triage",
      ...buildTriagePrompt({
        question: ctx.question,
        language: ctx.language,
        level: ctx.level,
        interpretation: ctx.interpretation,
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

  private async checkFollowup(
    ctx: RunContext,
    parent: ParentContext,
    question: string,
  ): Promise<FollowupCheck> {
    const result = await this.ask("followup check", {
      role: "triage",
      ...buildFollowupCheckPrompt({ parent, question, language: ctx.language, level: ctx.level }),
      schema: FollowupCheckSchema,
      traceId: ctx.id,
      signal: ctx.signal,
    });
    return { ...result.value, title: typeset(result.value.title, ctx.language) };
  }

  private writeOutline(
    ctx: RunContext,
    feedback: string | undefined,
    signal: AbortSignal = ctx.signal,
  ): Promise<GenerateResult<Outline>> {
    const { task, shape, language, level } = ctx;
    const prompt = task
      ? buildModeOutlinePrompt({ task, language, level, extra: feedback })
      : buildOutlinePrompt({
          question: ctx.interpretation ?? ctx.question,
          language,
          level,
          shape,
          extra: feedback,
        });
    return this.ask("outline", {
      role: "author",
      ...prompt,
      schema: OutlineSchema,
      validate: (value) => {
        Object.assign(value, repairOutline(value));
        const result = validateOutline(value, { shape });
        if (!result.ok) return formatIssues(result.issues);
        const misfit = task ? checkModeOutline(task, value) : null;
        if (misfit) return misfit;
        Object.assign(value, typesetTexts(value, language));
        return null;
      },
      traceId: ctx.id,
      signal,
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
      language: ctx.language,
      level: ctx.level,
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
    const { language, level, task } = ctx;
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
        const input = { outline, index, subject, language, level, extra };
        const written = await this.ask(`scene ${index}`, {
          role: "author",
          ...(task ? buildModeScenePrompt({ ...input, task }) : buildScenePrompt(input)),
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
