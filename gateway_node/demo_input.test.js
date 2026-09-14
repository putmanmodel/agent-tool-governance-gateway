import test from "node:test";
import assert from "node:assert/strict";
import { buildEvaluationInput } from "./demo_input.js";

test("demo observation fixture requires opt-in and leaves the default wrapper intact", () => {
  const body = { tool: "fs.list", args: { path: "/project" }, user_request: "." };
  const expected = { source: "tool_wrapper", text: 'TOOL fs.list args={"path":"/project"} user_request=.' };
  assert.deepEqual(buildEvaluationInput(body), expected);
  assert.deepEqual(buildEvaluationInput(body, true), expected);
  assert.throws(() => buildEvaluationInput({ ...body, demo_fixture: "low_confidence" }));
  assert.throws(() => buildEvaluationInput({ ...body, demo_fixture: "unknown" }, true));
  assert.deepEqual(buildEvaluationInput({ ...body, demo_fixture: "low_confidence" }, true), {
    source: "demo_fixture", fixture: "low_confidence", text: ".",
  });
  assert.deepEqual(body, { tool: "fs.list", args: { path: "/project" }, user_request: "." });
});
