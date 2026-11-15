import {} from "./client-schema-oracle";
import {} from "./background-preview-api";
import {} from "./prompter-storage";
import {} from "./site";
import {} from "@/components/takes/email-switch";
import {} from "@/components/takes/rename-form";
import {} from "@/components/takes/use-usage";
import {} from "@/components/takes/use-waveform";

export type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };

export const WRONG: readonly unknown[] = [
  null,
  undefined,
  "",
  "x",
  0,
  -1,
  1.5,
  1e21,
  true,
  false,
  [],
  {},
  [1],
  { a: 1 },
  "https://a.test",
];

/** Every way to damage `value` one step at a time: replace, drop or add at each place in it. */
export function variations(value: unknown): unknown[] {
  const out: unknown[] = [];
  const visit = (node: unknown, rebuild: (next: unknown) => unknown): void => {
    for (const bad of WRONG) out.push(rebuild(bad));
    if (Array.isArray(node)) {
      out.push(rebuild([]));
      out.push(rebuild([...node, ...node]));
      node.forEach((item, i) =>
        visit(item, (next) => rebuild(node.map((x, j) => (j === i ? next : x)))),
      );
    } else if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      out.push(rebuild({ ...obj, extra: 1 }));
      for (const key of Object.keys(obj)) {
        const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
        out.push(rebuild(rest));
        visit(obj[key], (next) => rebuild({ ...obj, [key]: next }));
      }
    }
  };
  visit(value, (next) => next);
  return out;
}

export function sameAnswer(next: Parser, old: Parser, input: unknown): string | null {
  const a = next.safeParse(input);
  const b = old.safeParse(input);
  if (a.success !== b.success) {
    return `new ${a.success ? "accepts" : "refuses"}, old ${b.success ? "accepts" : "refuses"}`;
  }
  if (a.success && JSON.stringify(a.data) !== JSON.stringify(b.data)) {
    return "parsed data differs";
  }
  return null;
}
