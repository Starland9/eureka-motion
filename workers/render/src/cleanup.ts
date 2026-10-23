import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../../../apps/web/src/server/db/client";
import { explanations, jobs } from "../../../apps/web/src/server/db/schema";

const HOUR_MS = 60 * 60 * 1000;

export const EXPORT_RETENTION_MS = 7 * 24 * HOUR_MS;
export const ORPHAN_RETENTION_MS = EXPORT_RETENTION_MS;
export const WRITE_GRACE_MS = HOUR_MS;
export const CLEANUP_START_DELAY_MS = 30_000;
export const CLEANUP_INTERVAL_MS = HOUR_MS;
export const CLEANUP_BATCH_SIZE = 100;

// The alphabet of newExplanationId in the web application.
const EXPLANATION_ID = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/;
const EXPORT_FILE = "export.mp4";
// The renderer writes .{name}.{uuid}.part.mp4 and the atomic writers {name}.{uuid}.tmp.
const IN_PROGRESS = /\.(?:part(?:\.mp4)?|tmp)$/;
const LOOKUP_CHUNK = 500;

export interface CleanupOptions {
  db: Database;
  mediaDir: string;
  now?: () => number;
  log?: Pick<Console, "info" | "error">;
  batchSize?: number;
}

export interface CleanupReport {
  exportsDeleted: number;
  explanationsDeleted: number;
  orphanFoldersDeleted: number;
  bytesFreed: number;
  errors: number;
}

export interface Cleanup {
  run(): Promise<CleanupReport>;
}

interface Footprint {
  bytes: number;
  newest: number;
  writing: boolean;
}

type Step = (report: CleanupReport, at: number) => Promise<void>;

export function isCleanupEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.CLEANUP?.trim().toLowerCase() !== "off";
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function lstatOrNull(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function measure(folder: string, writeCutoff: number): Promise<Footprint> {
  const print: Footprint = { bytes: 0, newest: (await lstat(folder)).mtimeMs, writing: false };
  const pending = [folder];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const info = await lstat(file);
      print.newest = Math.max(print.newest, info.mtimeMs);
      if (info.isDirectory()) {
        pending.push(file);
        continue;
      }
      if (info.isFile()) print.bytes += info.size;
      if (IN_PROGRESS.test(entry.name) && info.mtimeMs > writeCutoff) print.writing = true;
    }
  }
  return print;
}

export function createCleanup(options: CleanupOptions): Cleanup {
  const { db, mediaDir } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? console;
  const batchSize = options.batchSize ?? CLEANUP_BATCH_SIZE;

  function fail(report: CleanupReport, message: string, error: unknown): void {
    report.errors += 1;
    log.error(message, error);
  }

  function folderOf(id: string): string | null {
    return EXPLANATION_ID.test(id) ? path.join(mediaDir, id) : null;
  }

  // Symbolic links, files and names that are not explanation identifiers are never listed.
  async function listFolders(): Promise<string[]> {
    try {
      const entries = await readdir(mediaDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && EXPLANATION_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async function footprint(id: string, at: number): Promise<Footprint | null> {
    const folder = folderOf(id);
    const info = folder === null ? null : await lstatOrNull(folder);
    return folder !== null && info?.isDirectory() ? measure(folder, at - WRITE_GRACE_MS) : null;
  }

  async function subtreeOf(id: string): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`
      with recursive tree(id) as (
        select id from ${explanations} where id = ${id}
        union
        select c.id from ${explanations} c join tree t on c.parent_id = t.id or c.root_id = t.id
      )
      select id from tree`);
    return rows.map((row) => row.id);
  }

  const sweepExports: Step = async (report, at) => {
    const cutoff = at - EXPORT_RETENTION_MS;
    for (const id of await listFolders()) {
      if (report.exportsDeleted >= batchSize) break;
      try {
        const file = path.join(folderOf(id)!, EXPORT_FILE);
        const info = await lstatOrNull(file);
        if (!info?.isFile() || info.mtimeMs >= cutoff) continue;

        const [active] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.explanation_id, id),
              eq(jobs.type, "export"),
              inArray(jobs.status, ["queued", "running"]),
            ),
          )
          .limit(1);
        if (active) continue;

        // Rows first: a failure after this point leaves a file without a row, which heals itself.
        await db
          .delete(jobs)
          .where(
            and(eq(jobs.explanation_id, id), eq(jobs.type, "export"), eq(jobs.status, "succeeded")),
          );
        await rm(file);
        report.exportsDeleted += 1;
        report.bytesFreed += info.size;
      } catch (error) {
        fail(report, `The old export of ${id} could not be removed.`, error);
      }
    }
  };

  // An explanation goes only when its whole subtree is expired and idle: the foreign keys
  // cascade to the follow-ups, whose own 90 days (FR-032) may not be over.
  const sweepExpired: Step = async (report, at) => {
    const moment = new Date(at).toISOString();
    const candidates = await db.execute<{ id: string }>(sql`
      select e.id from ${explanations} e
      where e.kind <> 'reference' and e.expires_at <= ${moment}::timestamptz
        and not exists (
          with recursive tree(id) as (
            select e.id
            union
            select c.id from ${explanations} c join tree t on c.parent_id = t.id or c.root_id = t.id
          )
          select 1 from tree t join ${explanations} x on x.id = t.id
          where x.kind = 'reference' or x.expires_at is null
            or x.expires_at > ${moment}::timestamptz
            or exists (
              select 1 from ${jobs} j where j.explanation_id = t.id and j.status = 'running'
            )
        )
      order by e.expires_at, e.id
      limit ${batchSize}`);

    for (const { id } of candidates) {
      try {
        const subtree = await subtreeOf(id);
        if (subtree.length === 0) continue;

        const prints = new Map<string, Footprint | null>();
        for (const member of subtree) prints.set(member, await footprint(member, at));
        if ([...prints.values()].some((print) => print?.writing)) continue;

        const removed = await db
          .delete(explanations)
          .where(
            and(
              eq(explanations.id, id),
              ne(explanations.kind, "reference"),
              isNotNull(explanations.expires_at),
              lte(explanations.expires_at, new Date(at)),
            ),
          )
          .returning({ id: explanations.id });
        if (removed.length === 0) continue;
        report.explanationsDeleted += subtree.length;

        for (const member of subtree) {
          const print = prints.get(member);
          const folder = folderOf(member);
          if (!print || folder === null) continue;
          try {
            await rm(folder, { recursive: true });
            report.bytesFreed += print.bytes;
          } catch (error) {
            fail(report, `The media folder of ${member} could not be removed.`, error);
          }
        }
      } catch (error) {
        fail(report, `The expired explanation ${id} could not be removed.`, error);
      }
    }
  };

  const sweepOrphans: Step = async (report, at) => {
    const cutoff = at - ORPHAN_RETENTION_MS;
    const names = await listFolders();
    for (let start = 0; start < names.length; start += LOOKUP_CHUNK) {
      if (report.orphanFoldersDeleted >= batchSize) break;
      const chunk = names.slice(start, start + LOOKUP_CHUNK);
      const rows = await db
        .select({ id: explanations.id })
        .from(explanations)
        .where(inArray(explanations.id, chunk));
      const known = new Set(rows.map((row) => row.id));

      for (const id of chunk) {
        if (known.has(id)) continue;
        if (report.orphanFoldersDeleted >= batchSize) break;
        try {
          const print = await footprint(id, at);
          if (!print || print.newest >= cutoff) continue;
          await rm(folderOf(id)!, { recursive: true });
          report.orphanFoldersDeleted += 1;
          report.bytesFreed += print.bytes;
        } catch (error) {
          fail(report, `The orphan folder ${id} could not be removed.`, error);
        }
      }
    }
  };

  const steps: readonly (readonly [string, Step])[] = [
    ["old exports", sweepExports],
    ["expired explanations", sweepExpired],
    ["orphan folders", sweepOrphans],
  ];

  return {
    async run() {
      const report: CleanupReport = {
        exportsDeleted: 0,
        explanationsDeleted: 0,
        orphanFoldersDeleted: 0,
        bytesFreed: 0,
        errors: 0,
      };
      const at = now();
      for (const [name, step] of steps) {
        try {
          await step(report, at);
        } catch (error) {
          fail(report, `The cleanup of ${name} was interrupted.`, error);
        }
      }
      if (Object.values(report).some((count) => count > 0)) {
        log.info(
          `Cleanup: ${report.exportsDeleted} export(s), ${report.explanationsDeleted} explanation(s), ` +
            `${report.orphanFoldersDeleted} orphan folder(s), ${report.bytesFreed} byte(s) freed, ` +
            `${report.errors} error(s).`,
        );
      }
      return report;
    },
  };
}

export interface StartCleanupOptions extends CleanupOptions {
  startDelayMs?: number;
  intervalMs?: number;
  cleanup?: Cleanup;
}

export interface ScheduledCleanup {
  stop(): Promise<void>;
}

export function startCleanup(options: StartCleanupOptions): ScheduledCleanup {
  const cleanup = options.cleanup ?? createCleanup(options);
  const log = options.log ?? console;
  const intervalMs = options.intervalMs ?? CLEANUP_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  async function pass(): Promise<void> {
    try {
      await cleanup.run();
    } catch (error) {
      log.error("The cleanup pass failed.", error);
    }
    if (!stopped) arm(intervalMs);
  }

  // The next pass is armed only when this one is over, so two passes never overlap.
  function arm(ms: number): void {
    timer = setTimeout(() => {
      current = pass();
    }, ms);
  }

  arm(options.startDelayMs ?? CLEANUP_START_DELAY_MS);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
