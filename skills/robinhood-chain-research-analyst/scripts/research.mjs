import { createHash } from 'node:crypto';

export const VERSION = 'robinhood-launch-v2';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const WORD = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ZERO = '0x' + '0'.repeat(40);
const PONS_V1_FACTORIES = new Set([
  '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',
  '0x0c37a24f5d23a486fa692d1500881d698b1f77a4',
]);
const PONS_V2_FACTORIES = new Set([
  '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
]);
const SELECTOR = {
  launchFactory: '0x536dac9b', curve: '0x7165485d', launched: '0x3cf28b5a',
  token: '0xfc0c546a', factory: '0xc45a0155', pairToken: '0x3de35b79', graduated: '0xe7c2b772',
  reserves: '0x0902f1ac', realQuote: '0x4f1f58fd', reserved: '0x15a55347', sellable: '0x808bcddc',
  feeBps: '0x24a9d853', creatorTaxBps: '0xc1bb8901', threshold: '0x8b0bc501',
  liquidityPool: '0x665a11ca', restrictionEndBlock: '0x0861ac61', locker: '0xd7b96d4e',
  isLocked: '0x4a4fbeec', lockedPositions: '0xfa22143d', positionManager: '0x791b98bc', ownerOf: '0x6352211e',
};
const CURVE_SELL = '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const address = value => typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : null;
const wordAddress = value => typeof value === 'string' && WORD.test(value) && /^0x0{24}/i.test(value) ? address('0x' + value.slice(-40)) : null;
const words = value => typeof value === 'string' && /^0x(?:[0-9a-f]{64})+$/i.test(value) ? value.slice(2).match(/.{64}/g) : null;
const uintWord = value => /^[0-9a-f]{64}$/i.test(value ?? '') ? BigInt(`0x${value}`) : null;
const callData = (selector, addr) => `${selector}${addr.slice(2).padStart(64, '0')}`;
const uintCallData = (selector, value) => `${selector}${BigInt(value).toString(16).padStart(64, '0')}`;
const rawText = value => typeof value === 'bigint' ? value.toString() : null;

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
  const maxRequests = Math.min(32, Math.max(1, options.maxRequests ?? 32));
  const timeoutMs = Math.min(50_000, Math.max(100, options.timeoutMs ?? 40_000));
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
  let block = null, blockHash = null, creationHash = null, creationBlockNumber = null;
  const finish = status => ({ schemaVersion: 2, toolVersion: VERSION, status,
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
        creationBlockNumber = receipt.value.blockNumber;
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
            let trace = await rpc('debug_traceTransaction', [creationHash, { tracer: 'callTracer', timeout: '5s' }], true);
            if (!trace.ok) {
              const parity = await rpc('trace_transaction', [creationHash], true);
              if (parity.ok && Array.isArray(parity.value)) {
                const validPath = path => Array.isArray(path) && path.every(n => Number.isSafeInteger(n) && n >= 0);
                // Inspect the full bounded response before slicing retained frames:
                // an ancestor can appear after its child in provider output.
                const failedPaths = parity.value.filter(item => item?.error && validPath(item.traceAddress)).map(item => item.traceAddress);
                const malformedFailure = parity.value.some(item => item?.error && !validPath(item.traceAddress));
                const frames = parity.value.slice(0, 120).map(item => ({
                  type: String(item?.type ?? '').toUpperCase().slice(0, 20), from: address(item?.action?.from),
                  to: address(item?.result?.address ?? item?.action?.to), reverted: Boolean(item?.error) || malformedFailure || !validPath(item?.traceAddress)
                    || failedPaths.some(path => path.length <= item.traceAddress.length && path.every((part, index) => item.traceAddress[index] === part)),
                  depth: Array.isArray(item?.traceAddress) ? item.traceAddress.length : 0,
                  value: QUANTITY.test(item?.action?.value ?? '') ? item.action.value : null,
                  selector: /^0x[0-9a-f]{8}/i.test(item?.action?.input ?? '') ? item.action.input.slice(0, 10) : null,
                }));
                save(parity, { frames, bounded: true });
                const creates = frames.filter(f => f.type === 'CREATE' && f.to === target && !f.reverted);
                if (creates.length) finding('Internal creation call', `A non-reverted creation frame targets the token; immediate creator ${creates[0].from ?? 'unavailable'}.`, [parity.id, receipt.id]);
                else gap('trace', 'No successful creation frame for this token was established in the bounded trace.');
                finding('Creation call trace', `${frames.length} parity-style call frames retained (limit 120). Selectors and value transfers are follow-up evidence.`, [parity.id]);
                trace = { ok: false, id: parity.id };
              }
            }
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
  // Resolve PONS generation from token-reported factory references, then check
  // the corresponding factory record. A factory address by itself is never a
  // sufficient launch attribution.
  const launchFactoryRead = await rpc('eth_call', [{ to: target, data: SELECTOR.launchFactory }, block]);
  const curveRead = await rpc('eth_call', [{ to: target, data: SELECTOR.curve }, block]);
  const launchFactory = launchFactoryRead.ok ? wordAddress(launchFactoryRead.value) : null;
  const curve = curveRead.ok ? wordAddress(curveRead.value) : null;
  if (launchFactory && (PONS_V1_FACTORIES.has(launchFactory) || PONS_V2_FACTORIES.has(launchFactory))) {
    save(launchFactoryRead, launchFactory); if (curve) save(curveRead, curve);
    const generation = PONS_V2_FACTORIES.has(launchFactory) && curve ? 'v2' : 'v1';
    const record = await rpc('eth_call', [{ to: launchFactory, data: callData(SELECTOR.launched, target) }, block]);
    const rw = record.ok ? words(record.value) : null;
    const recordToken = rw ? wordAddress(`0x${rw[0]}`) : null;
    const recordCurve = generation === 'v2' && rw ? wordAddress(`0x${rw[1]}`) : null;
    const recordExists = rw && uintWord(rw[generation === 'v2' ? 14 : 11]) === 1n;
    if (record.ok && recordToken === target && recordExists && (generation === 'v1' || recordCurve === curve)) {
      save(record, { generation, token: recordToken, ...(recordCurve ? { curve: recordCurve } : {}), factory: launchFactory });
      finding('Launch protocol verified', `The token's reported factory address and the factory's exact launch record agree on PONS ${generation} at the saved block. This does not establish that the token reference can never change.`, [launchFactoryRead.id, record.id]);
      if (generation === 'v2') {
        const reads = await Promise.all([
          rpc('eth_call', [{ to: curve, data: SELECTOR.token }, block]), rpc('eth_call', [{ to: curve, data: SELECTOR.factory }, block]),
          rpc('eth_call', [{ to: curve, data: SELECTOR.reserves }, block]), rpc('eth_call', [{ to: curve, data: SELECTOR.realQuote }, block]),
          rpc('eth_call', [{ to: curve, data: SELECTOR.reserved }, block]), rpc('eth_call', [{ to: curve, data: SELECTOR.sellable }, block]),
          rpc('eth_call', [{ to: curve, data: SELECTOR.feeBps }, block]), rpc('eth_call', [{ to: curve, data: SELECTOR.creatorTaxBps }, block]),
          rpc('eth_call', [{ to: curve, data: SELECTOR.graduated }, block]),
        ]);
        const [curveToken, curveFactory] = reads.map((r, i) => i < 2 && r.ok ? wordAddress(r.value) : null);
        const reserveWords = reads[2].ok ? words(reads[2].value) : null;
        const quoteReserve = reserveWords ? uintWord(reserveWords[0]) : null, tokenReserve = reserveWords ? uintWord(reserveWords[1]) : null;
        const realQuote = reads[3].ok ? uintWord(words(reads[3].value)?.[0]) : null;
        const reserved = reads[4].ok ? uintWord(words(reads[4].value)?.[0]) : null;
        const sellable = reads[5].ok ? uintWord(words(reads[5].value)?.[0]) : null;
        const feeBps = reads[6].ok ? uintWord(words(reads[6].value)?.[0]) : null;
        const taxBps = reads[7].ok ? uintWord(words(reads[7].value)?.[0]) : null;
        const graduated = reads[8].ok ? uintWord(words(reads[8].value)?.[0]) : null;
        if (curveToken === target && curveFactory === launchFactory && [quoteReserve,tokenReserve,realQuote,reserved,sellable,feeBps,taxBps,graduated].every(v => v !== null)) {
          reads.forEach((r, i) => save(r, i < 2 ? [curveToken,curveFactory][i] : i === 2
            ? { quoteReserve: rawText(quoteReserve), tokenReserve: rawText(tokenReserve) }
            : rawText([realQuote,reserved,sellable,feeBps,taxBps,graduated][i - 3])));
          const phase = Number(uintWord(rw[10]));
          finding('PONS launch lifecycle', `Factory phase ${['curve trading','reserves swept','graduated pool created','rescued'][phase] ?? phase}; curve graduated flag ${graduated === 1n ? 'true' : 'false'}. Real quote reserve ${realQuote}; sellable allocation ${sellable} raw units.`, [record.id, ...reads.map(r => r.id)]);
          if (graduated === 0n && sellable > 0n && quoteReserve > 0n && tokenReserve > 0n && feeBps + taxBps <= 10_000n) {
            const sample = tokenReserve / 10_000n || 1n;
            const gross = sample * quoteReserve / (tokenReserve + sample);
            const net = gross - gross * feeBps / 10_000n - gross * taxBps / 10_000n;
            finding('Pinned sell quote', `${sample} raw token units map to ${net} raw quote units after ${feeBps + taxBps} bps combined curve fees at the pinned reserves. This is deterministic protocol math, not a wallet execution guarantee.`, [reads[2].id, reads[6].id, reads[7].id]);
            if (creationBlockNumber) {
              const from = `0x${(BigInt(block) - BigInt(creationBlockNumber) > 250_000n ? BigInt(block) - 250_000n : BigInt(creationBlockNumber)).toString(16)}`;
              const sells = await rpc('eth_getLogs', [{ address: curve, fromBlock: from, toBlock: block, topics: [CURVE_SELL] }]);
              if (sells.ok && Array.isArray(sells.value)) {
                const valid = sells.value.filter(log => address(log?.address) === curve && typeof log?.topics?.[0] === 'string' && log.topics[0].toLowerCase() === CURVE_SELL
                  && !log.removed && HASH.test(log?.transactionHash ?? '') && QUANTITY.test(log?.blockNumber ?? '')
                  && BigInt(log.blockNumber) >= BigInt(from) && BigInt(log.blockNumber) <= BigInt(block));
                const selected = valid.slice(-20).map(log => ({ transactionHash: log.transactionHash.toLowerCase(), blockNumber: log.blockNumber }));
                save(sells, { count: valid.length, selected, bounded: true, fromBlock: from, toBlock: block });
                if (valid.length) finding('Settled curve sells', `${valid.length} matching CurveSell logs were returned in the bounded on-chain window; ${selected.length} transaction references were retained. These are contract-emitted sell records, not an execution guarantee for every wallet or future block.`, [sells.id]);
                else gap('sellability', 'A current deterministic sell quote exists, but no settled CurveSell event was found in the bounded log window.');
              }
            }
          } else if (graduated !== 1n) gap('sellability', 'The curve does not currently expose a positive sellable reserve quote.');
          if (phase === 2) {
            const locker = await rpc('eth_call', [{ to: launchFactory, data: SELECTOR.locker }, block]);
            const lockerAddress = locker.ok ? wordAddress(locker.value) : null;
            if (lockerAddress) {
              save(locker, lockerAddress);
              const locked = await rpc('eth_call', [{ to: lockerAddress, data: callData(SELECTOR.isLocked, target) }, block]);
              const position = await rpc('eth_call', [{ to: lockerAddress, data: callData(SELECTOR.lockedPositions, target) }, block]);
              const isLocked = locked.ok ? uintWord(words(locked.value)?.[0]) : null;
              const positionId = position.ok ? uintWord(words(position.value)?.[0]) : null;
              if (isLocked === 1n && positionId && positionId > 0n) {
                save(locked, 'true'); save(position, positionId.toString());
                finding('Graduated liquidity custody', `The factory-selected locker reports the token's graduated position ${positionId} as locked. This does not measure its present market depth.`, [record.id, locker.id, locked.id, position.id]);
              } else gap('liquidity custody', 'The graduated position was not corroborated in the factory-selected locker.');
            }
          } else gap('liquidity custody', phase === 0 ? 'The token is still on its bonding curve and has no graduated pool position yet.' : 'A locked graduated position is not established for this lifecycle phase.');
        } else gap('PONS lifecycle', 'Curve identity or state could not be fully corroborated at the pinned block.');
      } else {
        const pool = await rpc('eth_call', [{ to: target, data: SELECTOR.liquidityPool }, block]);
        const restriction = await rpc('eth_call', [{ to: target, data: SELECTOR.restrictionEndBlock }, block]);
        const poolAddress = pool.ok ? wordAddress(pool.value) : null;
        const restrictionEnd = restriction.ok ? uintWord(words(restriction.value)?.[0]) : null;
        if (poolAddress && restrictionEnd !== null) {
          save(pool, poolAddress); save(restriction, restrictionEnd.toString());
          finding('PONS v1 pool', `Token getter resolves pool ${poolAddress}; launch restrictions ${restrictionEnd <= BigInt(block) ? 'ended' : 'are scheduled to end'} at block ${restrictionEnd}.`, [record.id, pool.id, restriction.id]);
          const positionManager = wordAddress(`0x${rw[3]}`), positionId = uintWord(rw[4]);
          const lockerRead = await rpc('eth_call', [{ to: launchFactory, data: SELECTOR.locker }, block]);
          const lockerAddress = lockerRead.ok ? wordAddress(lockerRead.value) : null;
          if (positionManager && positionId && positionId > 0n && lockerAddress) {
            save(lockerRead, lockerAddress);
            const owner = await rpc('eth_call', [{ to: positionManager, data: uintCallData(SELECTOR.ownerOf, positionId) }, block]);
            const positionOwner = owner.ok ? wordAddress(owner.value) : null;
            if (positionOwner === lockerAddress) {
              save(owner, positionOwner);
              finding('PONS v1 liquidity custody', `Position NFT ${positionId} is currently held by the locker selected by the exact launch factory. This establishes custody at the pinned block, not the absence of every possible exit path.`, [record.id, lockerRead.id, owner.id]);
            } else gap('PONS v1 liquidity custody', 'The launch position was not corroborated as owned by the factory-selected locker.');
          } else gap('PONS v1 liquidity custody', 'The factory record did not expose a complete position-manager, position-id, and locker identity.');
        } else gap('PONS v1 liquidity', 'The token did not return a valid canonical pool and restriction boundary.');
      }
    } else { if (record.ok) invalid(record, 'PONS attribution'); gap('launch protocol', 'Factory record did not corroborate this exact token and launch contract.'); }
  } else {
    if (launchFactoryRead.ok) invalid(launchFactoryRead, 'launch protocol');
    gap('launch protocol', 'No supported PONS factory was corroborated from the token contract.');
  }
  const market = await read('dexscreener', 'token-pairs', { chainId: 'robinhood', address: target }, `https://api.dexscreener.com/latest/dex/tokens/${target}`);
  if (market.ok && Array.isArray(market.value?.pairs)) {
    const pairs = market.value.pairs.filter(p => String(p?.chainId).toLowerCase() === 'robinhood'
      && [p?.baseToken?.address,p?.quoteToken?.address].some(a => address(a) === target)).slice(0, 5).map(p => ({
        pairAddress: typeof p.pairAddress === 'string' && (ADDRESS.test(p.pairAddress) || HASH.test(p.pairAddress)) ? p.pairAddress.toLowerCase() : null,
        dexId: String(p.dexId ?? '').slice(0, 60), liquidityUsd: Number.isFinite(p?.liquidity?.usd) ? p.liquidity.usd : null,
        txns: p?.txns && typeof p.txns === 'object' ? p.txns : null, url: typeof p.url === 'string' && p.url.startsWith('https://dexscreener.com/') ? p.url : null,
      }));
    save(market, { pairs, bounded: true });
    const liquid = pairs.filter(p => p.liquidityUsd !== null).sort((a,b) => b.liquidityUsd - a.liquidityUsd)[0];
    if (liquid) finding('Indexed market liquidity', `DexScreener attributes $${Math.round(liquid.liquidityUsd).toLocaleString('en-US')} of liquidity to the deepest exact-address Robinhood pair ${liquid.pairAddress ?? 'without a valid pair address'}. This is indexed market data, not proof of locked custody.`, [market.id], 'source_attributed');
    const recentSells = pairs.reduce((n,p) => n + (Number.isFinite(p.txns?.h24?.sells) ? p.txns.h24.sells : 0), 0);
    if (recentSells > 0) finding('Indexed recent sells', `DexScreener reports ${recentSells} sells across the retained exact-address pairs in its 24-hour window. This is attributed activity, not a simulated execution guarantee.`, [market.id], 'source_attributed');
    else gap('sellability', 'No recent sell activity was established from the retained market pairs.');
    if (liquid?.pairAddress) {
      const trades = await read('geckoterminal', 'pool-trades', { chainId: 'robinhood', pool: liquid.pairAddress },
        `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${liquid.pairAddress}/trades?page=1`);
      if (trades.ok && Array.isArray(trades.value?.data)) {
        const exits = trades.value.data.map(row => row?.attributes).filter(a => address(a?.from_token_address) === target
          && HASH.test(a?.tx_hash ?? '') && Number.isSafeInteger(a?.block_number) && a.block_number >= 0 && BigInt(a.block_number) <= BigInt(block)).slice(0, 20).map(a => ({
            transactionHash: a.tx_hash.toLowerCase(), blockNumber: a.block_number,
            blockTimestamp: typeof a.block_timestamp === 'string' ? a.block_timestamp : null,
            rawTokenAmount: typeof a.from_token_amount === 'string' ? a.from_token_amount.slice(0, 80) : null,
            usdVolume: typeof a.volume_in_usd === 'string' ? a.volume_in_usd.slice(0, 80) : null,
          }));
        save(trades, { targetWasInput: exits, bounded: true, returnedRows: trades.value.data.length });
        if (exits.length) {
          const settled = await rpc('eth_getTransactionReceipt', [exits[0].transactionHash]);
          if (settled.ok && settled.value?.transactionHash?.toLowerCase() === exits[0].transactionHash
            && settled.value?.status === '0x1' && QUANTITY.test(settled.value?.blockNumber ?? '')
            && BigInt(settled.value.blockNumber) === BigInt(exits[0].blockNumber)
            && BigInt(settled.value.blockNumber) <= BigInt(block)) {
            save(settled, { transactionHash: exits[0].transactionHash, blockNumber: settled.value.blockNumber, status: settled.value.status });
            finding('Recent settled pool exit', `GeckoTerminal identifies ${exits.length} recent trades where this token was the input asset. One retained transaction has a successful receipt matching the indexed block. Only that transaction is corroborated on-chain; its trade details and the remaining trades are still indexer-reported. This is not a guarantee that another wallet or future trade will succeed.`, [trades.id, settled.id], 'source_attributed');
          } else gap('sellability', 'Recent target-input trades were indexed, but their latest on-chain receipt was not corroborated at the pinned block.');
        } else gap('sellability', 'No exact-address target-input trade was found in the bounded pool history.');
      } else if (trades.ok) invalid(trades, 'sellability');
    } else gap('sellability', 'No valid pool identifier was available for bounded trade-history corroboration.');
  } else if (market.ok) invalid(market, 'market liquidity');
  const recheck = await rpc('eth_getBlockByNumber', [block, false]);
  if (!recheck.ok || recheck.value?.hash?.toLowerCase() !== blockHash) {
    gap('block consistency', 'Pinned block hash could not be confirmed at completion.');
    return finish('unavailable');
  }
  save(recheck, { number: block, hash: blockHash });
  return finish('partial');
}

export function validateResearch(result) {
  if (result?.schemaVersion !== 2 || result.toolVersion !== VERSION || result.target?.chainId !== 4663
    || !ADDRESS.test(result.target?.address ?? '') || !Array.isArray(result.observations) || !Array.isArray(result.findings)
    || !Array.isArray(result.gaps) || !['partial','unavailable'].includes(result.status)) throw new Error('Invalid research envelope');
  const ids = new Set(result.observations.filter(o => o.status === 'available' && o.responseHash && o.result !== undefined).map(o => o.id));
  if (result.findings.some(f => !['measured','source_attributed'].includes(f.strength) || !Array.isArray(f.evidence) || !f.evidence.length || f.evidence.some(id => !ids.has(id)))) throw new Error('Finding lacks retained evidence');
  if (result.usage.requests > result.usage.maxRequests || result.usage.maxRequests > 32) throw new Error('Request budget exceeded');
  return result;
}
