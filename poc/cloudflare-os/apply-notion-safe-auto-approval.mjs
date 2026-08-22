#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const actionsPath = resolve(root, "packages/gatekeeper-notion/src/notion-actions.ts");
const notionPath = resolve(root, "packages/gatekeeper-notion/src/notion.ts");
const testPath = resolve(root, "packages/gatekeeper-notion/__tests__/notion-auto-approval.test.ts");

for (const path of [actionsPath, notionPath]) {
  if (!existsSync(path)) {
    throw new Error(`Expected Cloudflare OS file not found: ${path}. Run this script from the cloudflare-os repository root.`);
  }
}

function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  const last = text.lastIndexOf(oldText);
  if (first === -1) throw new Error(`Upstream mismatch: ${label} anchor not found.`);
  if (first !== last) throw new Error(`Upstream mismatch: ${label} anchor is not unique.`);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

function replaceExactCount(text, oldText, newText, expected, label) {
  const parts = text.split(oldText);
  const count = parts.length - 1;
  if (count !== expected) {
    throw new Error(`Upstream mismatch: expected ${expected} ${label} occurrence(s), found ${count}.`);
  }
  return parts.join(newText);
}

let actions = readFileSync(actionsPath, "utf8");
let notion = readFileSync(notionPath, "utf8");

actions = replaceOnce(
  actions,
  'import type { ActionDescription, ApprovalQueue, ObservationDescription } from "@gadgets/workshop-shared/gatekeeper";',
  `import type {\n  ActionDescription,\n  ActionKind,\n  ApprovalQueue,\n  ObservationDescription,\n} from "@gadgets/workshop-shared/gatekeeper";`,
  "gatekeeper type import",
);

actions = replaceOnce(
  actions,
  `// The page (provisional or real) an action targets, or null for actions that don't target a page.`,
  `// ADP-045-B PoC only.\n//\n// This deliberately exposes one narrow auto-approval kind. It is intended only for a Gatekeeper\n// binding scoped to a dedicated PoC/task database. Generic setProperties must never be treated as\n// safe merely because it is reversible.\nexport const NOTION_TASK_SAFE_PROPERTIES_ACTION: ActionKind = {\n  tag: "notion.task.safe-properties",\n  label: "Update safe task properties",\n};\n\nexport const NOTION_AUTO_APPROVABLE_ACTIONS: ActionKind[] = [\n  NOTION_TASK_SAFE_PROPERTIES_ACTION,\n];\n\nconst SAFE_TASK_PROPERTY_TYPES = new Map<string, NotionPropertyInput["type"]>([\n  ["Status", "status"],\n  ["Result", "rich_text"],\n]);\n\nexport function isSafeTaskPropertyUpdate(action: NotionAction): boolean {\n  if (action.type !== "setProperties") return false;\n  const entries = Object.entries(action.properties);\n  if (entries.length === 0) return false;\n  return entries.every(([name, value]) => SAFE_TASK_PROPERTY_TYPES.get(name) === value.type);\n}\n\n// The page (provisional or real) an action targets, or null for actions that don't target a page.`,
  "safe-property policy insertion",
);

actions = replaceOnce(
  actions,
  `    case "setProperties":\n      return {\n        title: "Update Notion page properties",\n        description: \`Update properties: \${Object.keys(action.properties).join(", ") || "(none)"}.\`,\n        implementsRevert: true,\n      };`,
  `    case "setProperties": {\n      const autoApprovable = isSafeTaskPropertyUpdate(action);\n      return {\n        title: "Update Notion page properties",\n        description: \`Update properties: \${Object.keys(action.properties).join(", ") || "(none)"}.\`,\n        implementsRevert: true,\n        ...(autoApprovable ? {\n          actionKind: NOTION_TASK_SAFE_PROPERTIES_ACTION,\n          autoApprovable: true,\n        } : {}),\n      };\n    }`,
  "setProperties action description",
);

notion = replaceOnce(
  notion,
  `  NotionStore,\n  applyStoredAction,`,
  `  NotionStore,\n  NOTION_AUTO_APPROVABLE_ACTIONS,\n  applyStoredAction,`,
  "notion-actions import block",
);

notion = replaceExactCount(
  notion,
  `  async getAutoApprovableActions() {\n    return [];\n  }`,
  `  async getAutoApprovableActions() {\n    return NOTION_AUTO_APPROVABLE_ACTIONS;\n  }`,
  2,
  "getAutoApprovableActions",
);

const testSource = `import { describe, expect, it } from "vitest";\nimport {\n  describeAction,\n  isSafeTaskPropertyUpdate,\n  NOTION_TASK_SAFE_PROPERTIES_ACTION,\n  type NotionAction,\n} from "../src/notion-actions";\n\nfunction setProperties(\n  properties: Extract<NotionAction, { type: "setProperties" }>["properties"],\n): Extract<NotionAction, { type: "setProperties" }> {\n  return {\n    type: "setProperties",\n    pageId: "test-page",\n    properties,\n    previousProperties: {},\n  };\n}\n\ndescribe("Notion task-safe auto approval", () => {\n  it("allows Status updates", () => {\n    const action = setProperties({ Status: { type: "status", status: "In Progress" } });\n    expect(isSafeTaskPropertyUpdate(action)).toBe(true);\n    expect(describeAction(action)).toMatchObject({\n      actionKind: NOTION_TASK_SAFE_PROPERTIES_ACTION,\n      autoApprovable: true,\n    });\n  });\n\n  it("allows Result updates", () => {\n    const action = setProperties({ Result: { type: "rich_text", text: "PoC result" } });\n    expect(isSafeTaskPropertyUpdate(action)).toBe(true);\n  });\n\n  it("allows Status and Result together", () => {\n    const action = setProperties({\n      Status: { type: "status", status: "Done" },\n      Result: { type: "rich_text", text: "Completed" },\n    });\n    expect(isSafeTaskPropertyUpdate(action)).toBe(true);\n  });\n\n  it("does not allow unrelated properties", () => {\n    const action = setProperties({ Priority: { type: "select", option: "P1" } });\n    expect(isSafeTaskPropertyUpdate(action)).toBe(false);\n    expect(describeAction(action).autoApprovable).not.toBe(true);\n  });\n\n  it("does not allow a safe-name property with an unexpected type", () => {\n    const action = setProperties({ Status: { type: "rich_text", text: "In Progress" } });\n    expect(isSafeTaskPropertyUpdate(action)).toBe(false);\n  });\n\n  it("keeps archive manual", () => {\n    const action: NotionAction = { type: "archive", pageId: "test-page" };\n    expect(isSafeTaskPropertyUpdate(action)).toBe(false);\n    expect(describeAction(action).autoApprovable).not.toBe(true);\n  });\n});\n`;

writeFileSync(actionsPath, actions);
writeFileSync(notionPath, notion);
writeFileSync(testPath, testSource);

console.log("Applied ADP-045-B Notion safe-auto-approval PoC changes.");
console.log("Next: pnpm --filter @gadgets/notion-gatekeeper test:run");
