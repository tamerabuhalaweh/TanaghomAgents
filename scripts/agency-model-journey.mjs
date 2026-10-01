// One-command English/Arabic journey (brief -> strategy -> content -> human review sheet) for #177.
// Requires explicit authorization, a cleared kill switch, a verified model probe and a price for the spend cap.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceArtifact, workspaceRequest, modelEndpoint } from '../packages/agent-runtime/workspace.mjs';
import { callModel, connectionManifest, createRunBudget, killSwitchActive, modelsUrl, probeModelConnection } from '../packages/agent-runtime/model-connection.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
export const syntheticInput = {
  en: { title: 'Fictional photography course launch', brief: 'Prepare an organic Instagram launch plan and three post drafts for a beginner photography course. No paid ads.',
    source_facts: 'Fictional studio in Amman. Six evening lessons cover exposure, composition and editing. Price and start date are not confirmed. Tone: helpful and clear; no guarantees.' },
  ar: { title: 'إطلاق دورة تصوير تجريبية', brief: 'جهّز خطة إطلاق عضوية على إنستغرام وثلاث مسودات منشورات لدورة تصوير للمبتدئين. بدون إعلانات مدفوعة.',
    source_facts: 'استوديو تجريبي في عمّان. ست حصص مسائية عن التعريض والتكوين والتحرير. السعر وتاريخ البدء غير مؤكدين. النبرة: مفيدة وواضحة وبدون وعود.' },
};

export function readJourneyConfig(env) {
  const errors = [];
  const config = {
    url: env.AGENCY_MODEL_URL || modelEndpoint,
    apiKey: env.AGENCY_MODEL_API_KEY,
    price: Number(env.AGENCY_MODEL_PRICE_PER_1K_TOKENS_USD),
    release: env.RELEASE_COMMIT,
    owner: env.EVIDENCE_OWNER,
    model: env.AGENCY_MODEL_NAME || connectionManifest.model,
  };
  if (env[connectionManifest.authorization_env] !== 'true') errors.push('journey_not_authorized');
  if (killSwitchActive(env)) errors.push('kill_switch_active');
  if (!config.apiKey) errors.push('model_key_missing');
  if (env.AGENCY_MODEL_PRICE_PER_1K_TOKENS_USD === undefined || !Number.isFinite(config.price) || config.price < 0) errors.push('model_price_required');
  if (!/^[0-9a-f]{40}$/.test(config.release || '')) errors.push('release_commit_required');
  if (!config.owner) errors.push('evidence_owner_required');
  let parsed = null;
  try { parsed = new URL(config.url); } catch { errors.push('model_url_invalid'); }
  const loopbackTest = ['test', 'integration'].includes(env.APP_ENV) && parsed?.hostname === '127.0.0.1';
  if (parsed && parsed.protocol !== 'https:' && !loopbackTest) errors.push('model_url_https_required');
  if (parsed && !parsed.pathname.endsWith('/chat/completions')) errors.push('model_url_must_be_chat_completions');
  return { config, errors };
}

export async function runJourney({ config, input = syntheticInput, inputLabel = 'synthetic fixture (not approved customer knowledge)', env = process.env, fetch = globalThis.fetch, now = () => new Date() }) {
  const probe = await probeModelConnection({ url: modelsUrl(config.url), apiKey: config.apiKey, model: config.model, fetch, now });
  const evidence = { contract_version: connectionManifest.contract_version, release: config.release, owner: config.owner,
    model: config.model, input: inputLabel, probe, limits: connectionManifest.limits, steps: [], started_at: now().toISOString() };
  if (probe.state !== 'verified') return { passed: false, evidence: { ...evidence, error: probe.code } };
  const budget = createRunBudget({ pricePer1kTokensUsd: config.price, env });
  for (const language of connectionManifest.journey.languages) {
    const shared = [];
    for (const profile of connectionManifest.journey.profiles) {
      const facts = input[language];
      const task = { profile, language, model: config.model, ...facts, shared_context: shared,
        context_hash: `sha256:${sha(JSON.stringify(facts))}` };
      const step = { language, profile, status: 'failed', document: null };
      const started = Date.now();
      try {
        const request = workspaceRequest(task, probe.context_limit);
        const response = await callModel({ url: config.url, apiKey: config.apiKey, request, budget, fetch });
        const artifact = workspaceArtifact(task, response, Date.now() - started);
        Object.assign(step, { status: 'succeeded', document: artifact.document, document_sha256: sha(artifact.document),
          usage: artifact.usage, elapsed_ms: artifact.elapsed_ms });
        shared.push({ task_id: `${language}:${profile}`, profile, response_hash: step.document_sha256, document: artifact.document });
      } catch (error) {
        step.error = error.code || error.message;
      }
      evidence.steps.push(step);
      if (step.status !== 'succeeded') return { passed: false, evidence: { ...evidence, budget: budget.used, error: step.error } };
    }
  }
  return { passed: true, evidence: { ...evidence, budget: budget.used, finished_at: now().toISOString() } };
}

export function reviewSheet(evidence) {
  const sections = evidence.steps.filter((s) => s.document).map((s) => `## ${s.language === 'ar' ? 'Arabic' : 'English'} · ${s.profile}

Document SHA-256: \`${s.document_sha256}\` · tokens: ${s.usage?.total_tokens ?? 'not reported'}

<div dir="${s.language === 'ar' ? 'rtl' : 'ltr'}">

${s.document}

</div>
`).join('\n');
  return `# Human review sheet: real-model bilingual journey (#177)

Release \`${evidence.release}\` · model \`${evidence.model}\` · probe ${evidence.probe.state} at ${evidence.probe.checked_at}
Input: ${evidence.input} · calls ${evidence.budget?.calls ?? 0} · tokens ${evidence.budget?.tokens ?? 0} · estimated spend $${evidence.budget?.spend_usd ?? 0}

Nothing was published, sent or approved by the model. The reviewer decides below.

${sections}
## Decision (one per language)

| Language | Facts only from source? | No invented prices/dates/claims? | Correct language & tone? | Decision (approve / request changes) | Reviewer | Date |
| --- | --- | --- | --- | --- | --- | --- |
| English | | | | | | |
| Arabic | | | | | | |

Notes:
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config, errors } = readJourneyConfig(process.env);
  if (errors.length) { console.error(`Refused: ${errors.join(', ')}`); process.exit(2); }
  const inputPath = process.argv.find((a) => a.startsWith('--input='))?.slice(8);
  const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || 'tmp/agency-model-journey';
  const input = inputPath ? JSON.parse(await readFile(inputPath, 'utf8')) : syntheticInput;
  const { passed, evidence } = await runJourney({ config, input, inputLabel: inputPath ? `approved input file sha256 ${sha(JSON.stringify(input))}` : undefined });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(join(out, 'review-sheet.md'), reviewSheet(evidence));
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${evidence.steps.filter((s) => s.status === 'succeeded').length}/4 steps; evidence in ${out}`);
  process.exit(passed ? 0 : 1);
}
