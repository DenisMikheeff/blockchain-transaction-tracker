const incomingNetworks = {
  BTC: ['Bitcoin'],
  ETH: ['Ethereum'],
  USDT: ['Ethereum (ERC20)', 'TRON (TRC20)', 'BNB Smart Chain (BEP20)'],
  BNB: ['BNB Smart Chain'],
  TRX: ['TRON'],
  XRP: ['XRP Ledger']
};

const incomingTargets = { BTC: 6, ETH: 12, USDT: 12, BNB: 12, TRX: 20, XRP: 1 };
const incomingChainTargets = {
  'USDT|Ethereum (ERC20)': 12,
  'USDT|TRON (TRC20)': 20,
  'USDT|BNB Smart Chain (BEP20)': 12
};

const TRC20_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const MIN_POLL_INTERVAL_MS = 5000;
const MAX_POLL_INTERVAL_MS = 300000;

const $$ = (id) => document.getElementById(id);
const coin = $$('incoming-coin-select');
const chain = $$('incoming-chain-select');
const form = $$('incoming-form');
const button = form.querySelector('button[type="submit"]');
const stopButton = $$('stop-listening');
const intervalInput = $$('poll-interval');
const body = $$('incoming-body');

const monitor = {
  active: false,
  timer: null,
  ticker: null,
  inFlight: false,
  context: null,
  nextAt: 0,
  lastSeenHash: '',
  lastSeenTimestamp: 0,
  errorCount: 0,
  rows: []
};

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTimestamp(value) {
  if (!value && value !== 0) return 0;
  if (typeof value === 'number') return value > 1000000000000 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function targetFor(coinValue, chainValue) {
  return incomingChainTargets[`${coinValue}|${chainValue}`] || incomingTargets[coinValue] || 1;
}

function toAmountText(value, decimals, symbol) {
  if (value === null || value === undefined) return '-';
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return raw;
  const whole = BigInt(raw) / (10n ** BigInt(decimals));
  const fraction = BigInt(raw) % (10n ** BigInt(decimals));
  const fractionText = decimals > 0 ? `.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}` : '';
  return `${whole}${fractionText === '.' ? '' : fractionText} ${symbol}`;
}

function renderEmpty(text) {
  body.innerHTML = `<tr><td colspan="5" class="empty-cell">${text}</td></tr>`;
}

function renderStatus(status, pillClass = '') {
  $$('incoming-status').textContent = status;
  $$('incoming-pill').textContent = status;
  $$('incoming-pill').className = `status-pill ${pillClass}`.trim();
}

function renderNextPoll(text) {
  $$('incoming-next-poll').textContent = text;
}

function explorerLink(coinValue, chainValue, hash) {
  const lower = chainValue.toLowerCase();
  if (coinValue === 'BTC') return `https://www.blockchain.com/btc/tx/${hash}`;
  if (coinValue === 'ETH') return `https://etherscan.io/tx/${hash}`;
  if (coinValue === 'USDT') {
    if (lower.includes('tron')) return `https://tronscan.org/#/transaction/${hash}`;
    if (lower.includes('bep')) return `https://bscscan.com/tx/${hash}`;
    return `https://etherscan.io/tx/${hash}`;
  }
  if (coinValue === 'BNB') return `https://bscscan.com/tx/${hash}`;
  if (coinValue === 'TRX') return `https://tronscan.org/#/transaction/${hash}`;
  if (coinValue === 'XRP') return `https://xrpscan.com/tx/${hash}`;
  return '#';
}

function chainForRequest(coinValue, chainValue) {
  const lower = chainValue.toLowerCase();
  if (coinValue === 'USDT') {
    if (lower.includes('tron')) return 'TRON_USDT_TRC20';
    if (lower.includes('bep')) return 'BSC';
    return 'ETH';
  }
  if (coinValue === 'BNB') return 'BSC';
  return coinValue;
}

function setMeta(coinValue, chainValue, wallet) {
  $$('wallet-display').textContent = wallet || '-';
  $$('incoming-network').textContent = `${coinValue} • ${chainValue}`;
  $$('incoming-last-update').textContent = new Date().toLocaleTimeString();
}

function setButtons(isListening) {
  button.disabled = isListening;
  button.textContent = isListening ? 'Listening…' : 'Start listening';
  stopButton.disabled = !isListening;
}

async function json(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

async function btcIncoming(address) {
  const [txs, tip] = await Promise.all([
    json(`https://mempool.space/api/address/${encodeURIComponent(address)}/txs`),
    json('https://mempool.space/api/blocks/tip/height')
  ]);
  return (Array.isArray(txs) ? txs : [])
    .map((tx) => {
      const incomingValue = (tx.vout || [])
        .filter((o) => o.scriptpubkey_address === address)
        .reduce((sum, o) => sum + toNum(o.value), 0);
      if (incomingValue <= 0) return null;
      const confirmed = !!tx.status?.confirmed;
      const confirmations = confirmed ? Math.max(0, toNum(tip) - toNum(tx.status?.block_height) + 1) : 0;
      return {
        hash: tx.txid,
        status: confirmed ? 'Confirmed' : 'Pending',
        confirmations,
        target: 6,
        amount: `${(incomingValue / 100000000).toFixed(8).replace(/\.?0+$/, '')} BTC`,
        timestamp: parseTimestamp(tx.status?.block_time)
      };
    })
    .filter(Boolean);
}

async function evmIncoming(address, apiBase, symbol, target) {
  const payload = await json(`${apiBase}/api/v2/addresses/${encodeURIComponent(address)}/transactions?filter=to`);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => {
      const conf = toNum(item.confirmations || item.confirmation_count);
      const amount = toAmountText(item.value, toNum(item.token?.decimals ?? 18), symbol);
      return {
        hash: item.hash,
        status: conf > 0 ? 'Confirmed' : 'Pending',
        confirmations: conf,
        target,
        amount,
        timestamp: parseTimestamp(item.timestamp || item.block_timestamp || item.inserted_at)
      };
    })
    .filter((item) => item.hash);
}

async function tronIncoming(address, target, symbol) {
  const payload = await json(`https://apilist.tronscanapi.com/api/transaction?sort=-timestamp&count=true&limit=25&start=0&toAddress=${encodeURIComponent(address)}`);
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list
    .map((tx) => {
      const conf = toNum(tx.confirmations);
      const status = tx.contractRet === 'SUCCESS' ? (conf > 0 ? 'Confirmed' : 'Pending') : 'Pending';
      const amount = tx.amount_str || tx.amount || '-';
      return {
        hash: tx.hash,
        status,
        confirmations: conf,
        target,
        amount: amount === '-' ? '-' : `${amount} ${symbol}`,
        timestamp: parseTimestamp(tx.timestamp || tx.block_ts)
      };
    })
    .filter((item) => item.hash);
}

async function tronUsdtTrc20Incoming(address, target) {
  const payload = await json(`https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=25&start=0&toAddress=${encodeURIComponent(address)}&trc20Id=${TRC20_USDT_CONTRACT}`);
  const list = Array.isArray(payload?.token_transfers) ? payload.token_transfers : Array.isArray(payload?.data) ? payload.data : [];
  return list
    .map((tx) => {
      const hash = tx.transaction_id || tx.hash;
      const conf = toNum(tx.confirmations || tx.confirmed);
      const decimals = toNum(tx.decimals ?? tx.tokenInfo?.tokenDecimal ?? 6);
      const amountRaw = tx.quant || tx.amount_str || tx.amount;
      return {
        hash,
        status: conf > 0 ? 'Confirmed' : 'Pending',
        confirmations: conf,
        target,
        amount: amountRaw ? toAmountText(amountRaw, decimals, 'USDT') : '-',
        timestamp: parseTimestamp(tx.block_ts || tx.timestamp || tx.block_timestamp)
      };
    })
    .filter((item) => item.hash);
}

async function xrpIncoming(address) {
  const payload = await json(`https://data.ripple.com/v2/accounts/${encodeURIComponent(address)}/transactions?type=Payment&limit=25`);
  const list = Array.isArray(payload?.transactions) ? payload.transactions : [];
  return list
    .filter((item) => item?.tx?.Destination === address)
    .map((item) => {
      const ok = item.validated === true && item.tx?.TransactionResult === 'tesSUCCESS';
      return {
        hash: item.tx?.hash,
        status: ok ? 'Confirmed' : 'Pending',
        confirmations: ok ? 1 : 0,
        target: 1,
        amount: item.tx?.Amount ? `${item.tx.Amount} drops` : '-',
        timestamp: parseTimestamp(item.date || item.tx?.date)
      };
    })
    .filter((item) => item.hash);
}

async function fetchIncoming(coinValue, chainValue, address) {
  const reqChain = chainForRequest(coinValue, chainValue);
  if (reqChain === 'BTC') return btcIncoming(address);
  if (reqChain === 'ETH') return evmIncoming(address, 'https://eth.blockscout.com', coinValue === 'USDT' ? 'USDT' : 'ETH', targetFor(coinValue, chainValue));
  if (reqChain === 'BSC') return evmIncoming(address, 'https://bsc.blockscout.com', coinValue === 'USDT' ? 'USDT' : 'BNB', targetFor(coinValue, chainValue));
  if (reqChain === 'TRON_USDT_TRC20') return tronUsdtTrc20Incoming(address, targetFor(coinValue, chainValue));
  if (reqChain === 'TRX') return tronIncoming(address, targetFor(coinValue, chainValue), 'TRX');
  if (reqChain === 'XRP') return xrpIncoming(address);
  throw new Error('This network is not available yet');
}

function rowClass(status) {
  if (status === 'Confirmed') return 'confirmed';
  if (status === 'Failed') return 'failed';
  return 'pending';
}

function drawRows(list, coinValue, chainValue) {
  if (!list.length) {
    renderEmpty('Listening for incoming transactions...');
    return;
  }
  body.innerHTML = '';
  list.forEach((item) => {
    const tr = document.createElement('tr');
    const progress = Math.min(100, Math.max(0, (toNum(item.confirmations) / Math.max(1, toNum(item.target))) * 100));
    tr.innerHTML = `
      <td><a href="${explorerLink(coinValue, chainValue, item.hash)}" target="_blank" rel="noreferrer">${item.hash}</a></td>
      <td><span class="status-pill ${rowClass(item.status)}">${item.status}</span></td>
      <td>${item.confirmations} / ${item.target}</td>
      <td>${Math.round(progress)}%</td>
      <td>${item.amount || '-'}</td>
    `;
    body.appendChild(tr);
  });
}

function updateChains() {
  chain.innerHTML = (incomingNetworks[coin.value] || []).map((name) => `<option>${name}</option>`).join('');
}

function sortedByNewest(list) {
  return [...list].sort((a, b) => {
    if (toNum(b.timestamp) !== toNum(a.timestamp)) return toNum(b.timestamp) - toNum(a.timestamp);
    return String(b.hash).localeCompare(String(a.hash));
  });
}

function updateLastSeen(list) {
  if (!list.length) return;
  const newest = list[0];
  monitor.lastSeenHash = newest.hash;
  monitor.lastSeenTimestamp = toNum(newest.timestamp);
}

function extractNewRows(currentList) {
  if (!monitor.lastSeenHash && !monitor.lastSeenTimestamp) return [];
  const markerIndex = currentList.findIndex((item) => item.hash === monitor.lastSeenHash);
  if (markerIndex > 0) return currentList.slice(0, markerIndex);
  if (markerIndex === 0) return [];
  if (monitor.lastSeenTimestamp > 0) return currentList.filter((item) => toNum(item.timestamp) > monitor.lastSeenTimestamp);
  return currentList.filter((item) => item.hash !== monitor.lastSeenHash);
}

function updateCountdown() {
  if (!monitor.active) return;
  if (!monitor.nextAt) {
    renderNextPoll('Updating…');
    return;
  }
  const left = Math.max(0, Math.ceil((monitor.nextAt - Date.now()) / 1000));
  renderNextPoll(left ? `in ${left}s` : 'Updating…');
}

function scheduleNextPoll(delayMs) {
  if (!monitor.active) return;
  if (monitor.timer) clearTimeout(monitor.timer);
  const delay = Math.max(MIN_POLL_INTERVAL_MS, delayMs);
  monitor.nextAt = Date.now() + delay;
  monitor.timer = setTimeout(runPoll, delay);
  updateCountdown();
}

function stopTicker() {
  if (!monitor.ticker) return;
  clearInterval(monitor.ticker);
  monitor.ticker = null;
}

function startTicker() {
  stopTicker();
  monitor.ticker = setInterval(updateCountdown, 1000);
  updateCountdown();
}

function stopListening(reason = 'Stopped') {
  monitor.active = false;
  monitor.context = null;
  monitor.inFlight = false;
  monitor.nextAt = 0;
  if (monitor.timer) {
    clearTimeout(monitor.timer);
    monitor.timer = null;
  }
  stopTicker();
  renderNextPoll(reason);
  setButtons(false);
}

async function runPoll() {
  if (!monitor.active || monitor.inFlight || !monitor.context) return;
  monitor.inFlight = true;
  const { coinValue, chainValue, address, intervalMs } = monitor.context;
  try {
    const fetched = sortedByNewest(await fetchIncoming(coinValue, chainValue, address));
    setMeta(coinValue, chainValue, address);

    if (!monitor.lastSeenHash && !monitor.lastSeenTimestamp) {
      monitor.rows = fetched.slice(0, 50);
      drawRows(monitor.rows, coinValue, chainValue);
      updateLastSeen(fetched);
      renderStatus(monitor.rows.length ? 'Listening' : 'Listening (no transactions yet)');
    } else {
      const fresh = extractNewRows(fetched);
      if (fresh.length) {
        monitor.rows = [...fresh, ...monitor.rows].slice(0, 50);
        drawRows(monitor.rows, coinValue, chainValue);
        renderStatus(`Listening • ${fresh.length} new`, 'confirmed');
      } else if (!monitor.rows.length) {
        drawRows([], coinValue, chainValue);
        renderStatus('Listening (no transactions yet)');
      } else {
        renderStatus('Listening');
      }
      updateLastSeen(fetched);
    }

    monitor.errorCount = 0;
    scheduleNextPoll(intervalMs);
  } catch (error) {
    console.error(error);
    monitor.errorCount += 1;
    renderStatus(`API issue, retrying (${monitor.errorCount})`, 'retrying');
    if (!monitor.rows.length) {
      renderEmpty('Temporary API issue while listening. Retrying automatically...');
    }
    scheduleNextPoll(Math.min(toNum(monitor.context?.intervalMs) || 20000, 10000));
  } finally {
    monitor.inFlight = false;
  }
}

function startListening(coinValue, chainValue, address, intervalMs) {
  stopListening('Restarted');
  monitor.active = true;
  monitor.context = { coinValue, chainValue, address, intervalMs };
  monitor.lastSeenHash = '';
  monitor.lastSeenTimestamp = 0;
  monitor.errorCount = 0;
  monitor.rows = [];
  setButtons(true);
  renderStatus('Connecting...', 'retrying');
  renderNextPoll('Starting…');
  renderEmpty('Connecting to wallet and loading incoming transactions...');
  startTicker();
  monitor.nextAt = 0;
  runPoll();
}

coin.addEventListener('change', updateChains);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const coinValue = coin.value;
  const chainValue = chain.value;
  const address = $$('wallet-address').value.trim();
  if (!address) return;
  const intervalSeconds = Math.min(300, Math.max(5, toNum(intervalInput.value) || 20));
  intervalInput.value = String(intervalSeconds);
  startListening(coinValue, chainValue, address, intervalSeconds * 1000);
});

stopButton.addEventListener('click', () => {
  stopListening('Stopped by user');
  renderStatus('Stopped');
});

updateChains();
setButtons(false);
renderNextPoll('Waiting');
