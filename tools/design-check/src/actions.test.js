import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsProblem } from "./actions.js";

test("no actions, or a good list, is fine", () => {
  assert.equal(actionsProblem(undefined), null);
  assert.equal(actionsProblem([]), null);
  assert.equal(
    actionsProblem([
      { fill: { label: "Script", value: "Hi" } },
      { click: { role: "button", name: "Record" } },
      { click: "#start" },
      { waitFor: ".stage" },
      { wait: 500 },
    ]),
    null,
  );
});

test("a bad list says which step is wrong", () => {
  assert.match(actionsProblem({}), /list of steps/);
  assert.match(actionsProblem([{ tap: "#a" }]), /step 1 needs exactly one of/);
  assert.match(actionsProblem([{ click: "#a", wait: 1 }]), /step 1 needs exactly one of/);
  assert.match(actionsProblem([{ click: "#a" }, { click: { role: "button" } }]), /step 2: click/);
  assert.match(actionsProblem([{ fill: { value: "x" } }]), /step 1: fill/);
  // a supplied selector is what runs, so a bad one is rejected even beside a good label
  assert.match(
    actionsProblem([{ fill: { label: "Script", selector: 17, value: "Hi" } }]),
    /step 1: fill/,
  );
  assert.match(actionsProblem([{ waitFor: "" }]), /waitFor/);
  assert.match(actionsProblem([{ wait: 99999 }]), /wait takes/);
});

test("a label the draft hides at a step is not reported as missing motion", async () => {
  const { compareMotion } = await import("./compare.js");
  const rec = { label: "a", trigger: "load", props: ["opacity"], duration: 300 };
  const D = { elements: [{ label: "a", visible: false }], motion: [rec] };
  const B = { elements: [], motion: [] };
  const tol = { motionDuration: 0.2 };
  assert.equal(compareMotion(D, B, "desktop", tol, { stepPage: true })[0].length, 0);
  assert.equal(compareMotion(D, B, "desktop", tol)[0].length, 1);
  D.elements[0].visible = true;
  assert.equal(compareMotion(D, B, "desktop", tol, { stepPage: true })[0].length, 1);
});
