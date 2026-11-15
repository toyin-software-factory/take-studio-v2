// Click-through steps a page can run before it is measured, so a check can reach a state that only
// appears after a click (a wizard's second step, a dialog). Set `actions` (the build) and
// `designActions` (the design draft) on a page in design-check.json.
//
// One step is an object with exactly one of these keys:
//   { "click": "css selector" }                       or { "click": { "role": "button", "name": "Record" } }
//   { "fill": { "label": "Script", "value": "…" } }  or { "fill": { "selector": "textarea", "value": "…" } }
//   { "waitFor": "css selector" }                     the element is visible
//   { "wait": 1500 }                                  milliseconds, 30000 at most
const STEP_KEYS = ["click", "fill", "waitFor", "wait"];
const MAX_WAIT_MS = 30000;
const STEP_TIMEOUT_MS = 15000;

const isText = (v) => typeof v === "string" && v.trim() !== "";

// Returns a message for the first thing wrong with a list of steps, or null when it is fine.
export function actionsProblem(actions) {
  if (actions === undefined) return null;
  if (!Array.isArray(actions)) return "must be a list of steps";
  for (const [i, step] of actions.entries()) {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== "object" || Array.isArray(step)) return `${at} must be an object`;
    const keys = Object.keys(step);
    if (keys.length !== 1 || !STEP_KEYS.includes(keys[0]))
      return `${at} needs exactly one of: ${STEP_KEYS.join(", ")}`;
    const [key] = keys;
    const v = step[key];
    if (key === "click" && !(isText(v) || (v && isText(v.role) && isText(v.name))))
      return `${at}: click takes a selector, or { role, name }`;
    if (
      key === "fill" &&
      !(v && typeof v.value === "string" && (isText(v.label) || isText(v.selector)))
    )
      return `${at}: fill takes { label or selector, value }`;
    if (key === "waitFor" && !isText(v)) return `${at}: waitFor takes a selector`;
    if (key === "wait" && !(Number.isFinite(v) && v >= 0 && v <= MAX_WAIT_MS))
      return `${at}: wait takes milliseconds, 0 to ${MAX_WAIT_MS}`;
  }
  return null;
}

// Runs the steps in order. A step that cannot finish throws, with the step number in the message,
// so a broken click-through is reported instead of measuring the wrong state.
export async function runActions(page, actions = []) {
  for (const [i, step] of actions.entries()) {
    try {
      await runStep(page, step);
    } catch (e) {
      const first = String(e.message || e).split("\n")[0];
      throw new Error(`action ${i + 1} (${JSON.stringify(step)}) failed: ${first}`);
    }
  }
}

async function runStep(page, step) {
  const timeout = STEP_TIMEOUT_MS;
  if ("click" in step) {
    const t = step.click;
    const target =
      typeof t === "string"
        ? page.locator(t)
        : page.getByRole(t.role, { name: t.name, exact: true });
    return target.first().click({ timeout });
  }
  if ("fill" in step) {
    const { label, selector, value } = step.fill;
    const target = selector ? page.locator(selector) : page.getByLabel(label);
    return target.first().fill(value, { timeout });
  }
  if ("waitFor" in step)
    return page.locator(step.waitFor).first().waitFor({ state: "visible", timeout });
  return page.waitForTimeout(step.wait);
}
