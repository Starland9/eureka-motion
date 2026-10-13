export type Shortcut = "toggle" | "back" | "forward" | "mute" | "captions" | "fullscreen";
export type TargetKind = "modal" | "text" | "slider" | "pressable" | "other";

const BY_KEY = new Map<string, Shortcut>([
  [" ", "toggle"],
  ["Spacebar", "toggle"],
  ["ArrowLeft", "back"],
  ["ArrowRight", "forward"],
  ["m", "mute"],
  ["c", "captions"],
  ["f", "fullscreen"],
]);

const REPEATABLE: readonly Shortcut[] = ["back", "forward"];

const MODAL = "[role='dialog'], [role='alertdialog'], [aria-modal='true']";
const TEXT = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const SLIDER = "[role='slider']";
const PRESSABLE =
  "button, summary, a[href], [role='button'], [role='checkbox'], [role='switch'], [role='radio'], [role='tab'], [role='menuitem'], [role='option']";

export function shortcutFor(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return BY_KEY.get(event.key) ?? BY_KEY.get(event.key.toLowerCase()) ?? null;
}

export function isRepeatable(shortcut: Shortcut): boolean {
  return REPEATABLE.includes(shortcut);
}

export function targetKind(target: EventTarget | null): TargetKind {
  if (!(target instanceof Element)) return "other";
  if (target.closest(MODAL)) return "modal";
  if (target.closest(TEXT)) return "text";
  if (target.closest(SLIDER)) return "slider";
  if (target.closest(PRESSABLE)) return "pressable";
  return "other";
}

export function handledByTarget(kind: TargetKind, shortcut: Shortcut): boolean {
  switch (kind) {
    case "modal":
    case "text":
      return true;
    case "slider":
      return shortcut === "back" || shortcut === "forward";
    case "pressable":
      return shortcut === "toggle";
    default:
      return false;
  }
}
