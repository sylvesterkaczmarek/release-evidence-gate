// Run from the repository root with node --test tests/directory-plugin.test.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverPath = fileURLToPath(new URL('../directory-plugin/server.mjs', import.meta.url));

test('MCP tool checks evidence, stages a verifiable manifest and preserves it on retry', async t => {
  const home = await mkdtemp(join(tmpdir(), 'release-evidence-stage-'));
  const proc = spawn(process.execPath, [serverPath], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  let id = 0;
  async function call(method, params = {}) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const next = await replies.next();
    assert.equal(next.done, false);
    const reply = JSON.parse(next.value);
    assert.equal(reply.id, id);
    assert.equal(reply.error, undefined);
    return reply.result;
  }
  async function use(name, args) {
    return JSON.parse((await call('tools/call', { name, arguments: args })).content[0].text);
  }
  t.after(async () => {
    proc.stdin.end();
    await rm(home, { recursive: true, force: true });
  });

  assert.equal((await call('initialize', { protocolVersion: '2025-11-25' })).serverInfo.name, 'release-evidence-stage');
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await call('tools/list')).tools.map(tool => tool.name), ['inspect_example', 'stage_commit']);
  for (const [scenario, decision] of [['passing', 'would_stage'], ['stale_commit', 'blocked'], ['missing', 'blocked']]) {
    assert.equal((await use('inspect_example', { scenario })).decision, decision);
  }

  const target = { repository: 'demo/clock', commit_sha: 'a'.repeat(40) };
  const ci = join(home, '.config', 'release-evidence-stage', target.repository);
  const ledger = join(home, '.local', 'state', 'release-evidence-stage', target.repository);
  const receipt = { version: 1, ...target, suite: 'release-tests', conclusion: 'success', completed_at: new Date().toISOString() };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const stage = () => use('stage_commit', target);
  async function signRevision(overrides = {}) {
    const data = Buffer.from(JSON.stringify({ ...receipt, ...overrides }));
    await writeFile(join(ci, 'receipt.json'), data);
    await writeFile(join(ci, 'receipt.sig'), sign(null, data, privateKey));
  }

  assert.equal((await stage()).decision, 'blocked');
  assert.equal((await use('stage_commit', { ...target, repository: 'demo/..' })).decision, 'blocked');
  await mkdir(ci, { recursive: true });
  await writeFile(join(ci, 'ci-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  for (const change of [{ suite: 'lint' }, { commit_sha: 'b'.repeat(40) }, { repository: 'demo/other' },
    { conclusion: 'failure' }, { completed_at: '2000-01-01T00:00:00.000Z' }, { completed_at: '2100-01-01T00:00:00.000Z' }]) {
    await signRevision(change);
    assert.equal((await stage()).decision, 'blocked');
  }
  await signRevision();
  await writeFile(join(ci, 'receipt.json'), (await readFile(join(ci, 'receipt.json'), 'utf8')) + ' ');
  assert.equal((await stage()).decision, 'blocked');
  await assert.rejects(stat(ledger), { code: 'ENOENT' });

  await signRevision();
  assert.equal((await stage()).decision, 'staged_locally');
  const dest = join(ledger, target.commit_sha + '.json');
  const bytes = await readFile(dest, 'utf8');
  const record = JSON.parse(bytes);
  const signedBytes = Buffer.from(record.receipt_base64, 'base64');
  assert.equal(verify(null, signedBytes, publicKey, Buffer.from(record.signature_base64, 'base64')), true);
  assert.deepEqual(JSON.parse(signedBytes.toString('utf8')), receipt);
  assert.equal((await stat(dest)).mode & 0o777, 0o400);
  assert.equal((await stage()).decision, 'already_staged');
  assert.deepEqual(await readdir(ledger), [target.commit_sha + '.json']);
  assert.equal(await readFile(dest, 'utf8'), bytes);
});
