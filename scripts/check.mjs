import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function checkRepository(base = root) {
  const spec = JSON.parse(await readFile(path.join(base, 'benchmark.json'), 'utf8'));
  assert.equal(spec.rubric.reduce((sum, item) => sum + item.max, 0), 100);
  assert.equal(spec.rubric.slice(0, 4).reduce((sum, item) => sum + item.max, 0), 80);
  assert.equal(new Set(spec.rubric.map(item => item.id)).size, spec.rubric.length);
  assert.equal(spec.initialState.gridRows * spec.initialState.gridColumns, 28);
  assert.equal(spec.initialState.visibleTileCount, 28);
  assert.equal(spec.references.length, 3);
  assert.equal(spec.defaultTheme, 'dark');
  for (const ref of spec.references) {
    const bytes = await readFile(path.join(base, ref.file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${ref.file}: not PNG`);
    assert.equal(bytes.readUInt32BE(16), ref.width, `${ref.file}: width changed`);
    assert.equal(bytes.readUInt32BE(20), ref.height, `${ref.file}: height changed`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256, `${ref.file}: bytes changed`);
    for (const rect of Object.values(ref.screenRects ?? {})) {
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= ref.width && rect.y + rect.height <= ref.height);
    }
  }
  const prompt = await readFile(path.join(base, spec.prompt), 'utf8');
  assert.ok(prompt.includes(spec.version), 'Prompt version mismatch');
  for (const ref of spec.references) assert.ok(prompt.includes(ref.file), `Prompt missing ${ref.file}`);
  for (const id of Object.keys(spec.interactionApps)) assert.ok(prompt.includes(id), `Prompt missing ${id}`);
  for (const dir of ['', 'docs', 'references', 'results']) {
    for (const entry of await readdir(path.join(base, dir))) {
      if (!entry.endsWith('.md')) continue;
      const filename = path.join(base, dir, entry);
      const text = await readFile(filename, 'utf8');
      for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|#)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(filename), target.split('#')[0]);
        assert.ok((await stat(resolved)).isFile(), `${filename}: missing link ${target}`);
      }
    }
  }
  const template = JSON.parse(await readFile(path.join(base, 'results/template.json'), 'utf8'));
  assert.equal(template.status, 'pending');
  assert.equal(template.total, null);
  assert.deepEqual(Object.keys(template.scores).sort(), spec.rubric.map(item => item.id).sort());
  for (const score of Object.values(template.scores)) assert.equal(score.value, null);
  for (const dir of ['', 'starter']) {
    const pkg = JSON.parse(await readFile(path.join(base, dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(base, dir, 'package-lock.json'), 'utf8'));
    assert.equal(lock.name, pkg.name);
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
    assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  }
  return { version: spec.version, references: spec.references.length, total: 100, visual: 80 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log('Benchmark checks passed:', JSON.stringify(await checkRepository()));
  } catch (error) {
    console.error('Benchmark check failed:', error.message);
    process.exitCode = 1;
  }
}
