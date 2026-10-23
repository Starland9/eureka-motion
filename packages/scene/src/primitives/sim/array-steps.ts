export type ArrayAlgorithm = "bubble-sort" | "selection-sort" | "binary-search" | "linear-search";

export type Relation = "<" | ">" | "=" | "≠";

export interface ArrayStep {
  values: readonly number[];
  compare: { left: number; right: number; relation: Relation } | null;
  swap: readonly [number, number] | null;
  settled: readonly number[];
  probe: { index: number; relation: Relation } | null;
  window: { low: number; high: number } | null;
  found: number | null;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

function relationOf(a: number, b: number): Relation {
  if (a < b) return "<";
  return a > b ? ">" : "=";
}

function initial(values: readonly number[], window: ArrayStep["window"] = null): ArrayStep {
  const settled = values.length < 2 ? range(0, values.length) : [];
  return { values, compare: null, swap: null, settled, probe: null, window, found: null };
}

function exchange(values: number[], i: number, j: number): void {
  const held = values[i]!;
  values[i] = values[j]!;
  values[j] = held;
}

function bubbleSort(input: readonly number[]): ArrayStep[] {
  const values = [...input];
  const n = values.length;
  const steps = [initial([...values])];
  let settled: readonly number[] = steps[0]!.settled;
  for (let pass = 0; pass < n - 1; pass += 1) {
    const last = n - 1 - pass;
    let swapped = false;
    for (let j = 0; j < last; j += 1) {
      const needsSwap = values[j]! > values[j + 1]!;
      const closes = j === last - 1;
      const passSwapped: boolean = swapped || needsSwap;
      const closing = !passSwapped || last === 1 ? range(0, n) : range(last, n);
      steps.push({
        ...initial([...values]),
        settled: closes && !needsSwap ? closing : settled,
        compare: { left: j, right: j + 1, relation: relationOf(values[j]!, values[j + 1]!) },
      });
      if (needsSwap) {
        exchange(values, j, j + 1);
        steps.push({
          ...initial([...values]),
          settled: closes ? closing : settled,
          swap: [j, j + 1],
        });
      }
      swapped = passSwapped;
      if (closes) settled = closing;
    }
    if (!swapped) break;
  }
  return steps;
}

function selectionSort(input: readonly number[]): ArrayStep[] {
  const values = [...input];
  const n = values.length;
  const steps = [initial([...values])];
  let settled: readonly number[] = steps[0]!.settled;
  for (let i = 0; i < n - 1; i += 1) {
    const after = range(0, i === n - 2 ? n : i + 1);
    let min = i;
    for (let j = i + 1; j < n; j += 1) {
      const closes = j === n - 1;
      const next = values[j]! < values[min]! ? j : min;
      steps.push({
        ...initial([...values]),
        settled: closes && next === i ? after : settled,
        compare: { left: min, right: j, relation: relationOf(values[min]!, values[j]!) },
      });
      min = next;
    }
    if (min !== i) {
      exchange(values, i, min);
      steps.push({ ...initial([...values]), settled: after, swap: [i, min] });
    }
    settled = after;
  }
  return steps;
}

function binarySearch(input: readonly number[], target: number): ArrayStep[] {
  const values = [...input].sort((a, b) => a - b);
  let low = 0;
  let high = values.length - 1;
  const steps = [initial(values, { low, high })];
  while (low <= high) {
    const index = Math.floor((low + high) / 2);
    const relation = relationOf(values[index]!, target);
    steps.push({
      ...initial(values, { low, high }),
      probe: { index, relation },
      found: relation === "=" ? index : null,
    });
    if (relation === "=") return steps;
    if (relation === "<") low = index + 1;
    else high = index - 1;
  }
  steps.push(initial(values, { low, high }));
  return steps;
}

function linearSearch(values: readonly number[], target: number): ArrayStep[] {
  const last = values.length - 1;
  const steps = [initial(values, { low: 0, high: last })];
  for (let index = 0; index <= last; index += 1) {
    const relation: Relation = values[index] === target ? "=" : "≠";
    steps.push({
      ...initial(values, { low: index, high: last }),
      probe: { index, relation },
      found: relation === "=" ? index : null,
    });
    if (relation === "=") return steps;
  }
  steps.push(initial(values, { low: last + 1, high: last }));
  return steps;
}

export function arraySteps(
  algorithm: ArrayAlgorithm,
  values: readonly number[],
  target?: number,
): ArrayStep[] {
  switch (algorithm) {
    case "bubble-sort":
      return bubbleSort(values);
    case "selection-sort":
      return selectionSort(values);
    case "binary-search":
      return target === undefined ? [initial(values)] : binarySearch(values, target);
    case "linear-search":
      return target === undefined ? [initial(values)] : linearSearch(values, target);
  }
}
