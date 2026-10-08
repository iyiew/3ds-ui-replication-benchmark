import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRepository } from './check.mjs';
import { validateUrl, parseArgs } from './capture.mjs';
import { verifyRun } from './verify-run.mjs';

const spec = JSON.parse(await readFile(new URL('../benchmark.json', import.meta.url), 'utf8'));
const template = JSON.parse(await readFile(new URL('../results/template.json', import.meta.url), 'utf8'));

test('Reference integrity, links, blank result and package locks', async () => {
  assert.deepEqual(await checkRepository(), { version: '1.0.0', references: 3, total: 100, visual: 80 });
});
test('Capture accepts local candidate URLs only', () => {
  assert.equal(validateUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/');
  assert.equal(validateUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.throws(() => validateUrl('https://example.com'));
  assert.throws(() => validateUrl('file:///tmp/index.html'));
  assert.throws(() => validateUrl('http://user:password@localhost:5173'));
  assert.throws(() => parseArgs(['--unknown', 'value']));
  assert.throws(() => parseArgs(['--out']));
});
test('An unfilled template is not a model score', () => {
  assert.throws(() => verifyRun(template, spec), /not finalized/);
});

function completedRun() {
  const run = structuredClone(template);
  run.run_id = 'synthetic-validator-test';
  run.status = 'completed';
  run.benchmark.baseline_commit = 'a'.repeat(40);
  run.model = { name: 'test-only', version: 'test-only', agent_product: 'test-only' };
  run.environment.tools = ['test-only'];
  run.environment.image_input_verified = true;
  run.budget.elapsed_minutes = 10;
  run.reviewers = ['test-only'];
  for (const { id, max } of spec.rubric) run.scores[id] = { value: max, reason: 'Synthetic validation fixture, not a real benchmark result', evidence: ['test-only.png'] };
  run.total = 100;
  return run;
}
test('Score range and total are verified', () => {
  const run = completedRun();
  assert.equal(verifyRun(run, spec).visual, 80);
  run.total = 99;
  assert.throws(() => verifyRun(run, spec), /Total/);
  run.scores.hardware.value = 26;
  assert.throws(() => verifyRun(run, spec), /hardware/);
});
test('Completed scores need reasons, evidence and verified image input', () => {
  const run = completedRun();
  run.scores.upper_screen.reason = '';
  assert.throws(() => verifyRun(run, spec), /missing reason/);
  run.scores.upper_screen.reason = 'test-only';
  run.scores.upper_screen.evidence = [];
  assert.throws(() => verifyRun(run, spec), /missing evidence/);
  run.environment.image_input_verified = false;
  assert.throws(() => verifyRun(run, spec), /verified image/);
});
test('Invalid runs retain a reason but not a numeric leaderboard score', () => {
  const run = completedRun();
  run.status = 'invalid';
  assert.throws(() => verifyRun(run, spec), /numeric total/);
  run.total = null;
  run.notes = 'Synthetic invalid record for unit tests only';
  assert.equal(verifyRun(run, spec).total, null);
});
