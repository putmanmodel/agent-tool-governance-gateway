// A fixed, opt-in observation fixture. CDE still calculates the complete signal.
// Never accept a caller-supplied governance signal or arbitrary evaluation text.
export function buildEvaluationInput(body, fixturesEnabled = false) {
  if (Object.hasOwn(body, "demo_fixture")) {
    if (!fixturesEnabled || body.demo_fixture !== "low_confidence") {
      throw new Error("Unknown or disabled demo fixture");
    }
    return { source: "demo_fixture", fixture: "low_confidence", text: "." };
  }
  return {
    source: "tool_wrapper",
    text: `TOOL ${body.tool} args=${JSON.stringify(body.args ?? {})} user_request=${body.user_request}`,
  };
}
