import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../n8n/workflows/phase5/conversation-intelligence.v1.json", import.meta.url),
  "utf8",
));
const normalizeCode = workflow.nodes.find((node) => node.name === "Normalize Conversation Response")?.parameters?.jsCode;
assert.ok(normalizeCode, "Conversation response normalizer is missing");

const eventId = "9b2bb31e-611d-4a85-98f9-0ff964ee1e15";
const sourceId = "cf94739b-b3b9-4fd3-bc20-f906bb877d68";
const versionId = "4625a035-4600-4677-a3c8-1e743dd777dd";
const fingerprint = "md5:568c1636b0052c39a6adb5793ffd3116";
const prepared = {
  job_id: "9c03493f-c372-4aa0-982e-33918849cea1",
  event_id: eventId,
  request_body: {
    provider_message: { event_id: eventId },
    conversation_context: { recent_turns: [] },
    retrieved_knowledge: [{
      source_id: sourceId,
      source_version_id: versionId,
      content_fingerprint: fingerprint,
    }],
    system_policy: {
      confidence_threshold: 0.72,
      mandatory_escalations: ["complaint", "legal", "payment", "refund"],
    },
  },
};

const observedGemmaOutput = {
  contract_version: "phase5.conversation-intelligence-output.v1",
  prompt_version: "phase5.conversation-intelligence.prompt.v1",
  model_name: "gemma4-26b-a4b-canary",
  language: "en",
  intent: "inquiry_pricing",
  urgency: "medium",
  sentiment: "neutral",
  sales_stage: "awareness",
  risk_categories: [],
  next_best_action: "provide_pricing_information",
  confidence: 1,
  answer_status: "approved",
  proposed_reply: "The approved price is USD 99 per month.",
  citations: [{ source_id: sourceId, source_version_id: versionId, content_fingerprint: fingerprint }],
  escalation: { requires_escalation: false, reason: null },
  conversation_summary: {
    language: "en",
    summary: "The customer asked for the approved plan price.",
    input_event_ids: [eventId],
  },
  external_action_count: 0,
};

function normalize(output) {
  const execute = new Function("$json", "$", normalizeCode);
  const response = { body: { choices: [{ message: { content: JSON.stringify(output) } }] }, statusCode: 200 };
  return execute(response, (name) => {
    assert.equal(name, "Build Conversation Request");
    return { first: () => ({ json: structuredClone(prepared) }) };
  })[0].json;
}

test("Conversation normalizer safely canonicalizes the exact production enum aliases", () => {
  const result = normalize(structuredClone(observedGemmaOutput));
  assert.equal(result.ok, true);
  assert.equal(result.output.intent, "pricing");
  assert.equal(result.output.urgency, "normal");
  assert.equal(result.output.sales_stage, "discovery");
  assert.equal(result.output.next_best_action, "respond");
  assert.equal(result.output.answer_status, "proposal");
  assert.deepEqual(result.output.escalation, { required: false, category: null, reason: null });
  assert.equal(result.output.citations[0].content_fingerprint, fingerprint);
  assert.equal(result.output.external_action_count, 0);
});

test("Conversation normalizer rejects a citation that is not the retrieved approved version", () => {
  const output = structuredClone(observedGemmaOutput);
  output.citations[0].content_fingerprint = "md5:00000000000000000000000000000000";
  const result = normalize(output);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "gemma_contract_mismatch");
});

test("Conversation normalizer rejects unknown enum aliases", () => {
  const output = structuredClone(observedGemmaOutput);
  output.urgency = "moderate";
  const result = normalize(output);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "gemma_contract_mismatch");
});
