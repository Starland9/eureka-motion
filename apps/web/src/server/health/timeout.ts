const DEPENDENCY_TIMEOUT_MS = 3_000;

// postgres.js backs off after repeated failures: a stopped database can hold a query for seconds.
export async function within<T>(work: Promise<T>, ms: number = DEPENDENCY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${ms} ms.`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}
