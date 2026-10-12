import { createCn } from "cn/config";

// Keep in step with the keys of typeScale (packages/scene/src/tokens/typography.ts).
const TYPE_STYLES = [
  "display-xl",
  "display-l",
  "display-m",
  "title",
  "lead",
  "body-l",
  "body",
  "control",
  "caption",
  "data",
];

export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: TYPE_STYLES }] } },
});
