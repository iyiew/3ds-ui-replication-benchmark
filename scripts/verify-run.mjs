import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyRun(run, spec) {
  assert.equal(run.benchmark?.id, spec.id, 'Benchmark ID mismatch');
  assert.equal(run.benchmark?.version, spec.version, 'Benchmark version mismatch');
  assert.ok(['completed', 'invalid', 'infrastructure_failure'].includes(run.status), 'Run is not finalized');
  assert.ok(typeof run.run_id === 'string' && run.run_id.trim(), 'run_id is required');
  assert.match(run.benchmark.baseline_commit ?? '', /^[a-f0-9]{40}$/i, 'Baseline commit SHA is required');
  assert.ok(run.model?.name && run.model?.version && run.model?.agent_product, 'Model name, version and agent product are required');
  assert.ok(Array.isArray(run.environment?.tools) && run.environment.tools.length, 'Actual tool list is required');
  assert.equal(typeof run.environment?.image_input_verified, 'boolean', 'Image access must be recorded');
  assert.ok(Number.isFinite(run.budget?.limit_minutes) && run.budget.limit_minutes > 0, 'Budget is required');
  assert.ok(Number.isFinite(run.budget?.elapsed_minutes) && run.budget.elapsed_minutes >= 0, 'Elapsed time is required');
  assert.ok(Number.isInteger(run.budget.human_feedback_rounds) && run.budget.human_feedback_rounds >= 0);
  assert.equal(typeof run.budget.delegation_allowed, 'boolean');
  const expectedKeys = spec.rubric.map(item => item.id).sort();
  assert.deepEqual(Object.keys(run.scores ?? {}).sort(), expectedKeys, 'Score categories changed');
  if (run.status !== 'completed') {
    assert.equal(run.total, null, 'Invalid/infrastructure runs must not have a numeric total');
    assert.ok(typeof run.notes === 'string' && run.notes.trim(), 'Failure reason is required');
    return { status: run.status, total: null };
  }
  assert.ok(run.environment.image_input_verified, 'A completed result requires verified image input');
  assert.ok(Array.isArray(run.reviewers) && run.reviewers.length, 'At least one reviewer identifier is required');
  let total = 0;
  for (const { id, max } of spec.rubric) {
    const score = run.scores[id];
    assert.ok(Number.isFinite(score.value) && score.value >= 0 && score.value <= max, `${id}: invalid score`);
    assert.ok(typeof score.reason === 'string' && score.reason.trim(), `${id}: missing reason`);
    assert.ok(Array.isArray(score.evidence) && score.evidence.length, `${id}: missing evidence`);
    assert.ok(score.evidence.every(item => typeof item === 'string' && item.trim()), `${id}: invalid evidence path`);
    total += score.value;
  }
  assert.ok(Number.isFinite(run.total) && Math.abs(total - run.total) < 0.000001, 'Total does not match scores');
  return { status: run.status, total, visual: spec.rubric.slice(0, 4).reduce((sum, item) => sum + run.scores[item.id].value, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv[2], 'Usage: npm run verify-run -- results/run.json');
    const run = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
    const spec = JSON.parse(await readFile(new URL('../benchmark.json', import.meta.url), 'utf8'));
    console.log('Run record valid:', JSON.stringify(verifyRun(run, spec)));
  } catch (error) {
    console.error('Run record invalid:', error.message);
    process.exitCode = 1;
  }
}
