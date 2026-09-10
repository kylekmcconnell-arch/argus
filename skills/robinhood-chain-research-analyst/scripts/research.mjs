import { createHash } from 'node:crypto';

export const VERSION = 'robinhood-launch-v1';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const WORD = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ZERO = '0x' + '0'.repeat(40);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const address = value => typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : null;
const wordAddress = value => typeof value === 'string' && WORD.test(value) && /^0x0{24}/i.test(value) ? address('0x' + value.slice(-40)) : null;

/** Read-only, dependency-free runner. No wallet or transaction submission API. */
export async function researchLaunch(input, options = {}) {
  const target = address(input.address);
  if (input.chain !== 'robinhood' || !target) throw new Error('Robinhood mainnet and an exact EVM contract address are required');
  const rpcUrl = options.rpcUrl || RPC;
  const traceUrl = options.archiveRpcUrl || rpcUrl;
  for (const value of [rpcUrl, traceUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('RPC endpoints must use HTTPS without URL userinfo');
  }
  const fetcher = options.fetcher || fetch;
  if ((options.maxRequests !== undefined && !Number.isInteger(options.maxRequests))
    || (options.timeoutMs !== undefined && !Number.isFinite(options.timeoutMs))) throw new Error('Invalid request budget');
  const maxRequests = Math.min(24, Math.max(1, options.maxRequests ?? 20));
  const timeoutMs = Math.min(40_000, Math.max(100, options.timeoutMs ?? 32_000));
  const deadline = Date.now() + timeoutMs;
  const startedAt = new Date().toISOString();
  const observations = [], findings = [], gaps = [];
  let requests = 0;
  const gap = (area, reason) => { if (!gaps.some(g => g.area === area && g.reason === reason)) gaps.push({ area, reason }); };
  const finding = (label, detail, evidence, strength = 'measured') => findings.push({ label, detail, evidence, strength });
  // Endpoint URLs (which can contain credentials) and provider error bodies are
  // never copied into results. Reproduction uses a provider label + method/params.
  async function read(provider, method, params, url, body) {
    const id = `e${observations.length + 1}`;
    const observation = { id, provider, method, params, capturedAt: new Date().toISOString(), status: 'unavailable' };
    observations.push(observation);
    if (requests >= maxRequests || Date.now() >= deadline) {
      observation.status = 'budget_deferred'; gap(method, 'Request or time limit reached.'); return { id, ok: false };
    }
    requests++;
    try {
      const response = await fetcher(url, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(Math.max(1, Math.min(7_000, deadline - Date.now()))),
      });
      if (!response.ok) {
        observation.status = [401,403,429].includes(response.status) ? 'reachable_but_restricted' : 'unavailable';
        observation.httpStatus = response.status;
        gap(method, `Provider returned HTTP ${response.status}.`); return { id, ok: false };
      }
      // Bound decompressed body size before parsing, including very large traces.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty_body');
      let bytes = 0; const chunks = [];
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1_000_000) { await reader.cancel(); throw new Error('response_limit'); }
        chunks.push(Buffer.from(part.value));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body && (data?.error || data?.result == null)) {
        observation.status = data?.error?.code === -32601 ? 'unsupported' : 'unavailable';
        gap(method, observation.status === 'unsupported' ? 'RPC method is unsupported.' : 'RPC did not return a usable result.');
        return { id, ok: false };
      }
      const value = body ? data.result : data;
      observation.status = 'available'; observation.responseHash = sha(value);
      return { id, ok: true, value };
    } catch {
      gap(method, 'Request timed out, exceeded the response limit, or returned invalid data.');
      return { id, ok: false };
    }
  }
  const rpc = (method, params, trace = false) => read(trace ? 'archive-rpc' : 'rpc', method, params, trace ? traceUrl : rpcUrl, { jsonrpc: '2.0', id: requests + 1, method, params });
  const save = (result, value) => { if (result.ok) observations.find(o => o.id === result.id).result = value; };
  const invalid = (result, area) => { observations.find(o => o.id === result.id).status = 'invalid_response'; gap(area, 'Provider response failed identity or format validation.'); };
  let block = null, blockHash = null, creationHash = null;
  const finish = status => ({ schemaVersion: 1, toolVersion: VERSION, status,
    target: { chain: 'robinhood', chainId: 4663, address: target, block, blockHash },
    startedAt, completedAt: new Date().toISOString(), findings, gaps, observations,
    usage: { requests, maxRequests, elapsedMs: Date.now() - Date.parse(startedAt), costUsd: null,
      note: 'Request count is measured; provider price is not known. No model calls were made.' },
  });
  const chain = await rpc('eth_chainId', []);
  if (!chain.ok) return finish('unavailable');
  if (chain.value !== '0x1237') {
    observations.find(o => o.id === chain.id).status = 'chain_mismatch';
    gap('identity', 'RPC chain ID does not match Robinhood mainnet (4663). No contract analysis was performed.');
    return finish('unavailable');
  }
  save(chain, chain.value);
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!head.ok || !QUANTITY.test(head.value?.number ?? '') || !HASH.test(head.value?.hash ?? '')) {
    if (head.ok) invalid(head, 'block'); return finish('unavailable');
  }
  block = head.value.number; blockHash = head.value.hash.toLowerCase();
  save(head, { number: block, hash: blockHash, timestamp: head.value.timestamp });
  const code = await rpc('eth_getCode', [target, block]);
  if (!code.ok || !/^0x(?:[0-9a-f]{2})+$/i.test(code.value ?? '')) {
    gap('contract', code.ok && code.value === '0x' ? 'No runtime contract code at the pinned block.' : 'Runtime code could not be validated.');
    return finish('unavailable');
  }
  save(code, { bytes: (code.value.length - 2) / 2, sha256: sha(code.value) });
  finding('Contract identity', `Runtime code exists at block ${BigInt(block)} on Robinhood mainnet.`, [chain.id, head.id, code.id]);
  const [owner, supply, implementation] = await Promise.all([
    rpc('eth_call', [{ to: target, data: '0x8da5cb5b' }, block]),
    rpc('eth_call', [{ to: target, data: '0x18160ddd' }, block]),
    rpc('eth_getStorageAt', [target, IMPLEMENTATION, block]),
  ]);
  if (owner.ok) {
    const value = wordAddress(owner.value);
    if (value) { save(owner, value); finding('Reported owner', `owner() returned ${value}. This does not enumerate every role or privileged control path.`, [owner.id]); }
    else invalid(owner, 'owner');
  }
  if (supply.ok && WORD.test(supply.value)) { save(supply, supply.value); finding('Pinned supply', `${BigInt(supply.value)} raw token units. Decimals are not applied.`, [supply.id]); }
  else if (supply.ok) invalid(supply, 'supply');
  if (implementation.ok) {
    const value = wordAddress(implementation.value);
    if (value) { save(implementation, value); finding('Standard proxy slot', value === ZERO ? 'The EIP-1967 implementation slot is zero. Other proxy designs and privileged paths remain possible.' : `The EIP-1967 implementation slot points to ${value}. Upgrade authority has not been established.`, [implementation.id]); }
    else invalid(implementation, 'proxy');
  }
  let discovery = await read('blockscout', 'getcontractcreation', { address: target }, `${EXPLORER}/api?module=contract&action=getcontractcreation&contractaddresses=${target}`);
  let row = discovery.ok && discovery.value?.status === '1' && Array.isArray(discovery.value.result)
    ? discovery.value.result.find(r => address(r.contractAddress) === target) : null;
  if (!row || !HASH.test(row.txHash ?? '')) {
    if (discovery.ok) invalid(discovery, 'Blockscout creation discovery');
    const alternate = await read('sourcify', 'contract.deployment', { chainId: 4663, address: target },
      `https://sourcify.dev/server/v2/contract/4663/${target}?fields=deployment`);
    if (alternate.ok && String(alternate.value?.chainId) === '4663' && address(alternate.value?.address) === target
      && HASH.test(alternate.value?.deployment?.transactionHash ?? '')) {
      row = { contractAddress: target, txHash: alternate.value.deployment.transactionHash, contractCreator: alternate.value.deployment.deployer };
      discovery = alternate;
    } else if (alternate.ok) invalid(alternate, 'Sourcify creation discovery');
  }
  if (row && HASH.test(row.txHash ?? '')) {
    creationHash = row.txHash.toLowerCase();
    save(discovery, { contractAddress: target, txHash: creationHash, contractCreator: address(row.contractCreator), contractFactory: address(row.contractFactory) });
    finding('Indexed creation transaction', `The contract registry attributes this contract to ${creationHash}. Receipt and trace checks below establish what can be corroborated.`, [discovery.id], 'source_attributed');
    const receipt = await rpc('eth_getTransactionReceipt', [creationHash]);
    const validReceipt = receipt.ok && receipt.value?.transactionHash?.toLowerCase() === creationHash
      && receipt.value.status === '0x1' && QUANTITY.test(receipt.value.blockNumber ?? '')
      && BigInt(receipt.value.blockNumber) <= BigInt(block) && HASH.test(receipt.value.blockHash ?? '') && Array.isArray(receipt.value.logs);
    if (validReceipt) {
      const creationBlock = await rpc('eth_getBlockByNumber', [receipt.value.blockNumber, false]);
      if (creationBlock.ok && creationBlock.value?.hash?.toLowerCase() === receipt.value.blockHash.toLowerCase()) {
        save(creationBlock, { number: receipt.value.blockNumber, hash: receipt.value.blockHash });
        const transfers = receipt.value.logs.filter(log => address(log.address) === target && log.topics?.length === 3
          && log.topics[0]?.toLowerCase() === TRANSFER && wordAddress(log.topics[1]) && wordAddress(log.topics[2]) && WORD.test(log.data ?? '') && !log.removed);
        const selected = transfers.slice(0, 100).map(log => ({ from: wordAddress(log.topics[1]), to: wordAddress(log.topics[2]), rawAmount: BigInt(log.data).toString(), logIndex: log.logIndex }));
        save(receipt, { transactionHash: creationHash, blockNumber: receipt.value.blockNumber, blockHash: receipt.value.blockHash,
          status: receipt.value.status, contractAddress: address(receipt.value.contractAddress), transfers: selected, transferCount: transfers.length });
        if (address(receipt.value.contractAddress) === target) finding('Creation corroborated', 'The successful transaction receipt identifies this exact deployed contract.', [discovery.id, receipt.id, creationBlock.id]);
        const recipients = new Set(selected.filter(t => t.to !== ZERO).map(t => t.to));
        finding('Transfers in creation transaction', `${transfers.length} token Transfer events; ${recipients.size} distinct nonzero recipients in the first ${selected.length} decoded events. Transfers alone do not establish buys, shared ownership or coordination.`, [receipt.id]);
        if (transfers.length > selected.length) gap('allocations', 'Creation transfers exceed the 100-event display limit; recipient count is a lower bound.');
        if (options.trace !== false) {
          let traceChainOk = true;
          if (traceUrl !== rpcUrl) {
            const traceChain = await rpc('eth_chainId', [], true); traceChainOk = traceChain.ok && traceChain.value === '0x1237';
            if (traceChainOk) save(traceChain, traceChain.value);
            else { if (traceChain.ok) observations.find(o => o.id === traceChain.id).status = 'chain_mismatch'; gap('trace', 'Archive RPC did not establish Robinhood mainnet identity.'); }
          }
          if (traceChainOk) {
            const trace = await rpc('debug_traceTransaction', [creationHash, { tracer: 'callTracer', timeout: '5s' }], true);
            if (trace.ok && trace.value && typeof trace.value === 'object' && typeof trace.value.type === 'string') {
              const frames = [], pending = [{ frame: trace.value, depth: 0, reverted: false }];
              while (pending.length && frames.length < 120) {
                const { frame, depth, reverted } = pending.pop();
                if (!frame || typeof frame !== 'object') continue;
                const failed = reverted || Boolean(frame.error);
                frames.push({ type: String(frame.type ?? '').slice(0, 20), from: address(frame.from), to: address(frame.to), reverted: failed, depth,
                  value: QUANTITY.test(frame.value ?? '') ? frame.value : null, selector: /^0x[0-9a-f]{8}/i.test(frame.input ?? '') ? frame.input.slice(0, 10) : null });
                if (Array.isArray(frame.calls) && depth < 32) for (const child of frame.calls.slice(0,120).reverse()) pending.push({ frame: child, depth: depth + 1, reverted: failed });
              }
              save(trace, { frames, bounded: true });
              const creates = frames.filter(f => /^(CREATE|CREATE2)$/.test(f.type) && f.to === target && !f.reverted);
              if (creates.length) finding('Internal creation call', `A non-reverted creation frame targets the token; immediate creator ${creates[0].from ?? 'unavailable'}.`, [trace.id, receipt.id]);
              else gap('trace', 'No successful creation frame for this token was established in the bounded trace.');
              finding('Creation call trace', `${frames.length} call frames retained (limit 120). Selectors and value transfers are evidence for follow-up, not decoded buys or fee attribution.`, [trace.id]);
            } else if (trace.ok) invalid(trace, 'trace');
          }
        } else gap('trace', 'Internal-call tracing was disabled for this run.');
      } else gap('creation', 'Creation block could not be corroborated against the receipt.');
    } else { if (receipt.ok) invalid(receipt, 'creation'); }
  } else { if (discovery.ok) invalid(discovery, 'creation'); }
  gap('launch lifecycle', 'PONS curve state, graduation, fee recipients and v4 liquidity custody require protocol-specific verification; this first runner does not assert them.');
  gap('sellability', 'No trading simulation, complete holder reconstruction or historical exit analysis was performed.');
  const recheck = await rpc('eth_getBlockByNumber', [block, false]);
  if (!recheck.ok || recheck.value?.hash?.toLowerCase() !== blockHash) {
    gap('block consistency', 'Pinned block hash could not be confirmed at completion.');
    return finish('unavailable');
  }
  save(recheck, { number: block, hash: blockHash });
  return finish('partial');
}

export function validateResearch(result) {
  if (result?.schemaVersion !== 1 || result.toolVersion !== VERSION || result.target?.chainId !== 4663
    || !ADDRESS.test(result.target?.address ?? '') || !Array.isArray(result.observations) || !Array.isArray(result.findings)
    || !Array.isArray(result.gaps) || !['partial','unavailable'].includes(result.status)) throw new Error('Invalid research envelope');
  const ids = new Set(result.observations.filter(o => o.status === 'available' && o.responseHash && o.result !== undefined).map(o => o.id));
  if (result.findings.some(f => !['measured','source_attributed'].includes(f.strength) || !Array.isArray(f.evidence) || !f.evidence.length || f.evidence.some(id => !ids.has(id)))) throw new Error('Finding lacks retained evidence');
  if (result.usage.requests > result.usage.maxRequests || result.usage.maxRequests > 24) throw new Error('Request budget exceeded');
  return result;
}
