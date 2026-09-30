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

const $$ = (id) => document.getElementById(id);
const coin = $$('incoming-coin-select');
const chain = $$('incoming-chain-select');
const form = $$('incoming-form');
const button = form.querySelector('button');
const body = $$('incoming-body');

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
    if (lower.includes('tron')) return 'TRON';
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
  const result = (Array.isArray(txs) ? txs : [])
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
        amount: `${(incomingValue / 100000000).toFixed(8).replace(/\.?0+$/, '')} BTC`
      };
    })
    .filter(Boolean);
  return result;
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
        amount
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
      const status = tx.contractRet === 'SUCCESS' ? (conf > 0 ? 'Confirmed' : 'Pending') : 'Failed';
      const amount = tx.amount_str || tx.amount || '-';
      return {
        hash: tx.hash,
        status,
        confirmations: conf,
        target,
        amount: amount === '-' ? '-' : `${amount} ${symbol}`
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
        amount: item.tx?.Amount ? `${item.tx.Amount} drops` : '-'
      };
    })
    .filter((item) => item.hash);
}

async function fetchIncoming(coinValue, chainValue, address) {
  const reqChain = chainForRequest(coinValue, chainValue);
  if (reqChain === 'BTC') return btcIncoming(address);
  if (reqChain === 'ETH') return evmIncoming(address, 'https://eth.blockscout.com', coinValue === 'USDT' ? 'USDT' : 'ETH', targetFor(coinValue, chainValue));
  if (reqChain === 'BSC') return evmIncoming(address, 'https://bsc.blockscout.com', coinValue === 'USDT' ? 'USDT' : 'BNB', targetFor(coinValue, chainValue));
  if (reqChain === 'TRON') return tronIncoming(address, targetFor(coinValue, chainValue), coinValue === 'USDT' ? 'USDT' : 'TRX');
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
    renderEmpty('No incoming transactions were found for this wallet.');
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

coin.addEventListener('change', updateChains);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const coinValue = coin.value;
  const chainValue = chain.value;
  const address = $$('wallet-address').value.trim();
  if (!address) return;

  button.disabled = true;
  button.textContent = 'Searching…';
  setMeta(coinValue, chainValue, address);
  renderStatus('Loading', 'retrying');
  renderEmpty('Loading incoming transactions...');

  try {
    const list = await fetchIncoming(coinValue, chainValue, address);
    drawRows(list, coinValue, chainValue);
    renderStatus(list.length ? 'Loaded' : 'No transactions');
  } catch (error) {
    console.error(error);
    renderStatus('Failed', 'failed');
    renderEmpty('Failed to load incoming transactions for this wallet and network.');
  } finally {
    button.disabled = false;
    button.textContent = 'Find incoming transactions';
  }
});

updateChains();
