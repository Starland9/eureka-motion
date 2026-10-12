import path from "node:path";
import type { Beat, Language, Scene } from "scene";
import { isSafeSegment, writeFileAtomic } from "../media";
import type { SynthesizedAudio, Synthesiser, VoiceChain } from "../tts";
import type { VoiceService } from "./ports";

const PARALLEL_BEATS = 4;

export interface VoiceServiceConfig {
  chain: VoiceChain;
  mediaDir: string;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function speakAll(
  voice: Synthesiser,
  beats: readonly Beat[],
  language: Language,
): Promise<(SynthesizedAudio | null)[]> {
  const speak = (beat: Beat): Promise<SynthesizedAudio | null> =>
    voice.synthesize({ text: beat.narration, language }).catch(() => null);
  const spoken = await mapLimit(beats, PARALLEL_BEATS, speak);

  // The voice may have switched provider part-way: redo the beats spoken by another one.
  const target = voice.provider;
  await mapLimit(spoken, PARALLEL_BEATS, async (audio, index) => {
    if (audio && audio.provider !== target) {
      spoken[index] = (await speak(beats[index]!)) ?? audio;
    }
  });
  return spoken;
}

export function createVoiceService({ chain, mediaDir }: VoiceServiceConfig): VoiceService {
  const root = path.resolve(mediaDir);

  return {
    async narrate(explanationId, scene, language): Promise<Scene> {
      const narrated = structuredClone(scene);
      const spoken = isSafeSegment(explanationId)
        ? await speakAll(chain.forExplanation(explanationId), narrated.beats, language)
        : [];

      await mapLimit(narrated.beats, PARALLEL_BEATS, async (beat, index) => {
        const audio = spoken[index];
        const name = `${scene.id}-${beat.id}.mp3`;
        delete beat.audio;
        if (!audio || !isSafeSegment(name)) return;
        try {
          await writeFileAtomic(path.join(root, explanationId, name), audio.audio);
          beat.audio = { url: `/media/${explanationId}/${name}`, duration_ms: audio.durationMs };
        } catch {
          // A file that cannot be written is the same as a voice that failed: no audio.
        }
      });
      return narrated;
    },
  };
}
