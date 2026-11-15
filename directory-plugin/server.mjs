// All runtime code for the local MCP server. No package dependencies.
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const suite = 'release-tests';
const maxAge = 24 * 60 * 60 * 1000;
const exampleNames = ['passing', 'stale_commit', 'missing'];
const tools = [
  {
    name: 'inspect_example',
    description: 'Run a signed CI receipt example in memory. No account, files or network are used.',
    inputSchema: {
      type: 'object', properties: { scenario: { type: 'string', enum: exampleNames } },
      required: ['scenario'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stage_commit',
    description: 'Check a locally provisioned CI receipt and atomically stage this exact commit in a local ledger. Does not publish a remote release.',
    inputSchema: {
      type: 'object',
      properties: { repository: { type: 'string', description: 'owner/repo' },
                    commit_sha: { type: 'string', description: 'Exact 40-character lowercase Git SHA' } },
      required: ['repository', 'commit_sha'], additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function exactKeys(params, keys) {
  return params && typeof params === 'object' && !Array.isArray(params)
    && Object.keys(params).length === keys.length && keys.every(k => Object.hasOwn(params, k));
}

function targetIsValid(repo, commit) {
  return typeof repo === 'string' && /^[a-z\d][a-z\d-]{0,38}\/[a-z\d][a-z\d._-]{0,99}$/.test(repo)
    && typeof commit === 'string' && /^[a-f\d]{40}$/.test(commit);
}

function checkReceipt(evidence, repo, commit, now) {
  if (!evidence) throw new Error('The trusted signer, receipt or signature is missing.');
  const trusted = typeof evidence.key === 'object' && evidence.key.type === 'public'
    ? evidence.key : createPublicKey(evidence.key);
  if (trusted.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 CI signing key is required.');
  if (!verify(null, evidence.raw, trusted, evidence.sig)) throw new Error('The signature did not verify.');
  const data = JSON.parse(evidence.raw.toString('utf8'));
  if (data.version !== 1 || data.repository !== repo || data.commit_sha !== commit)
    throw new Error('The signed receipt belongs to a different commit, repository or format.');
  if (data.suite !== suite || data.conclusion !== 'success')
    throw new Error('A passing release-tests result is required.');
  const timestamp = Date.parse(data.completed_at);
  if (typeof data.completed_at !== 'string' || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString() !== data.completed_at)
    throw new Error('Use a UTC timestamp including milliseconds.');
  if (timestamp > now || now - timestamp > maxAge) throw new Error('CI evidence expired or is future-dated.');
  return data;
}

function inspectExample(scenario) {
  const repo = 'demo/clock';
  const commit = 'a'.repeat(40);
  const now = Date.now();
  const receipt = { version: 1, repository: repo, commit_sha: scenario === 'stale_commit' ? 'b'.repeat(40) : commit,
                    suite, conclusion: 'success', completed_at: new Date(now).toISOString() };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(JSON.stringify(receipt));
  const sample = { raw, key: publicKey, sig: sign(null, raw, privateKey) };
  try {
    checkReceipt(scenario === 'missing' ? null : sample, repo, commit, now);
    return { scenario, decision: 'would_stage', repository: repo, commit_sha: commit };
  } catch (error) {
    return { scenario, decision: 'blocked', reason: error.message };
  }
}

async function readSmall(path, limit) {
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Expected a regular evidence file.');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) return buffer.subarray(0, offset);
      offset += bytesRead;
    }
    throw new Error('Evidence file exceeds the size limit.');
  } finally {
    await handle.close();
  }
}

async function stage(repo, commit) {
  if (!targetIsValid(repo, commit)) throw new Error('Use a lowercase owner/repository and a full 40-character commit hash.');
  const evidenceDir = join(homedir(), '.config', 'release-evidence-stage', repo);
  let evidence;
  try {
    const [key, raw, sig] = await Promise.all([
      readSmall(join(evidenceDir, 'ci-public.pem'), 4096), readSmall(join(evidenceDir, 'receipt.json'), 16384),
      readSmall(join(evidenceDir, 'receipt.sig'), 64),
    ]);
    evidence = { key, raw, sig };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const receipt = checkReceipt(evidence, repo, commit, Date.now());
  const directory = join(homedir(), '.local', 'state', 'release-evidence-stage', repo);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, commit + '.json');
  const temporary = join(directory, '.' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      const record = {
        version: 1, repository: repo, commit_sha: commit, ci_completed_at: receipt.completed_at,
        suite: receipt.suite, receipt_sha256: createHash('sha256').update(evidence.raw).digest('hex'),
        receipt_base64: evidence.raw.toString('base64'), signature_base64: evidence.sig.toString('base64'),
      };
      await handle.writeFile(JSON.stringify(record) + '\n');
      await handle.chmod(0o400);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse((await readSmall(destination, 32768)).toString('utf8'));
      if (previous.repository !== repo || previous.commit_sha !== commit)
        throw new Error('Existing staged record conflicts with the requested target.');
      return { decision: 'already_staged', repository: repo, commit_sha: commit };
    }
  } finally {
    await unlink(temporary);
  }
  return { decision: 'staged_locally', repository: repo, commit_sha: commit };
}

function result(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError };
}

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return { error: { code: -32600, message: 'Invalid JSON-RPC request' } };
  const params = message.params || {};
  switch (message.method) {
    case 'initialize':
      return { result: {
        protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0],
        serverInfo: { name: 'release-evidence-stage', version: '0.1.0' }, capabilities: { tools: {} },
      } };
    case 'ping': return { result: {} };
    case 'tools/list': return { result: { tools } };
    case 'tools/call': {
      const args = params.arguments;
      try {
        if (params.name === 'inspect_example' && exactKeys(args, ['scenario']) && exampleNames.includes(args.scenario))
          return { result: result(inspectExample(args.scenario)) };
        if (params.name === 'stage_commit' && exactKeys(args, ['repository', 'commit_sha']))
          return { result: result(await stage(args.repository, args.commit_sha)) };
        return { error: { code: -32602, message: 'Unknown tool or invalid arguments' } };
      } catch (error) {
        return { result: result({ decision: 'blocked', reason: error.message }, true) };
      }
    }
    default: return { error: { code: -32601, message: 'Method not found' } };
  }
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    continue;
  }
  if (!message || !Object.hasOwn(message, 'id')) continue;
  const response = await handle(message);
  console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...response }));
}
