const networks = {
  BTC: ['Bitcoin'], ETH: ['Ethereum'], USDT: ['Ethereum (ERC20)', 'TRON (TRC20)', 'BNB Smart Chain (BEP20)'], SOL: ['Solana'], BNB: ['BNB Smart Chain'], ADA: ['Cardano'], DOGE: ['Dogecoin'], XRP: ['XRP Ledger'], TRX: ['TRON'], LTC: ['Litecoin']
};
const targets = { BTC:6, ETH:12, USDT:12, SOL:12, BNB:12, ADA:20, DOGE:6, XRP:1, TRX:20, LTC:6 };
const POLL_INTERVAL_INITIAL_MS = 10000;
const POLL_INTERVAL_MID_MS = 25000;
const POLL_INTERVAL_NEAR_MS = 60000;
const POLL_RETRY_BASE_MS = 10000;
const POLL_RETRY_MAX_MS = 40000;
const MAX_MONITORING_MS = 15 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const coin = $('coin-select'), chain = $('chain-select'), form = $('tracker-form'), button = form.querySelector('button');
const poller = { active:false, timer:null, ticker:null, inFlight:false, context:null, startMs:0, nextAt:0, retryCount:0, lastUpdateMs:0 };
function updateChains(){ chain.innerHTML = (networks[coin.value] || []).map(n => `<option>${n}</option>`).join(''); }
function explorer(c,n,h){ const x=String(n).toLowerCase(); const urls={BTC:`https://www.blockchain.com/btc/tx/${h}`,ETH:`https://etherscan.io/tx/${h}`,USDT:x.includes('tron')?`https://tronscan.org/#/transaction/${h}`:x.includes('bep')?`https://bscscan.com/tx/${h}`:`https://etherscan.io/tx/${h}`,SOL:`https://solscan.io/tx/${h}`,BNB:`https://bscscan.com/tx/${h}`,ADA:`https://cardanoscan.io/transaction/${h}`,DOGE:`https://dogechain.info/tx/${h}`,XRP:`https://xrpscan.com/tx/${h}`,TRX:`https://tronscan.org/#/transaction/${h}`,LTC:`https://blockchair.com/litecoin/transaction/${h}`}; return urls[c] || '#'; }
async function json(url, options={}){ const r=await fetch(url,{headers:{Accept:'application/json'},...options}); if(!r.ok) throw Error(`API ${r.status}`); return r.json(); }
async function firstSuccess(providers, context='providers'){
  const errors=[];
  for(const provider of providers){
    try{ return await provider(); }catch(error){ errors.push(error); }
  }
  const message=errors.map((error)=>error?.message||String(error)).join(' | ');
  throw Error(`${context} unavailable${message?`: ${message}`:''}`);
}
function render(r,c,n,h){ const p=Math.max(0,Math.min(100,r.progress||0)); $('transaction-status').textContent=r.status; $('status-pill').textContent=r.status; $('status-pill').className=`status-pill ${r.status.toLowerCase()}`; $('progress-text').textContent=`${Math.round(p)}%`; $('progress-bar').style.width=`${p}%`; $('confirmations').textContent=r.confirmations ?? 0; $('network-name').textContent=r.network||n; $('target-confirmations').textContent=r.target||targets[c]; $('block-height').textContent=r.block||'-'; $('tx-hash-display').textContent=h; $('explorer-link').href=explorer(c,n,h); $('explorer-link').textContent='Open explorer'; $('last-update').textContent=new Date().toLocaleTimeString(); }
function txStatusResult(conf,target,network,block='-'){ return {status:conf?'Confirmed':'Pending',confirmations:conf,target,block:block||'-',network,progress:Math.min(conf/target*100,100)}; }
async function btcVia(base,h){ const [t,height]=await Promise.all([json(`${base}/tx/${h}`),json(`${base}/blocks/tip/height`)]); const ok=!!t.status?.confirmed, conf=ok?Math.max(0,Number(height)-Number(t.status.block_height)+1):0; return txStatusResult(conf,6,'Bitcoin',ok?t.status.block_height:'-'); }
async function btc(h){ return firstSuccess([()=>btcVia('https://mempool.space/api',h),()=>btcVia('https://blockstream.info/api',h)],'Bitcoin APIs'); }
async function blockscoutV2(base,h,network,target){ const t=await json(`${base}/api/v2/transactions/${h}`); const conf=Number(t.confirmations||t.confirmation_count||0); return txStatusResult(conf,target,network,t.block_number); }
async function blockscoutV1(base,h,network,target){ const t=await json(`${base}/api?module=transaction&action=gettxinfo&txhash=${encodeURIComponent(h)}`); const row=t?.result||{}; const conf=Number(row.confirmations||0); return txStatusResult(conf,target,network,row.blockNumber||row.block_number); }
async function blockscout(h,network,c){ const target=targets[c]; return firstSuccess([()=>blockscoutV2('https://eth.blockscout.com',h,network,target),()=>blockscoutV1('https://eth.blockscout.com',h,network,target)],'Ethereum APIs'); }
async function bsc(h){ return firstSuccess([()=>blockscoutV2('https://bsc.blockscout.com',h,'BNB Smart Chain',12),()=>blockscoutV1('https://bsc.blockscout.com',h,'BNB Smart Chain',12)],'BNB Smart Chain APIs'); }
async function solRpc(endpoint,h){ const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[h,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]})}; const t=await json(endpoint,post); if(!t?.result)return {status:'Pending',confirmations:0,target:12,network:'Solana',block:'-',progress:0}; return {status:'Confirmed',confirmations:1,target:12,network:'Solana',block:`Slot ${t.result.slot||'-'}`,progress:8.33}; }
async function sol(h){ return firstSuccess([()=>solRpc('https://api.mainnet-beta.solana.com',h),()=>solRpc('https://solana-rpc.publicnode.com',h),()=>solRpc('https://rpc.ankr.com/solana',h)],'Solana RPCs'); }
async function tronViaTronscan(h){ const t=await json(`https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(h)}`); const conf=Number(t.confirmations||0); return txStatusResult(conf,20,'TRON',t.blockNumber); }
async function tronViaTrongrid(h){ const [info,now]=await Promise.all([json('https://api.trongrid.io/wallet/gettransactioninfobyid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:h})}),json('https://api.trongrid.io/wallet/getnowblock',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})]); const block=Number(info.blockNumber||0), tip=Number(now?.block_header?.raw_data?.number||0), conf=block>0&&tip>0?Math.max(0,tip-block+1):0; return txStatusResult(conf,20,'TRON',block||'-'); }
async function tron(h){ return firstSuccess([()=>tronViaTronscan(h),()=>tronViaTrongrid(h)],'TRON APIs'); }
async function xrpViaDataApi(h){ const t=await json(`https://data.ripple.com/v2/transactions/${encodeURIComponent(h)}`); const ok=t.validated===true&&(!t.outcome||t.outcome.result==='tesSUCCESS'); return {status:ok?'Confirmed':'Pending',confirmations:ok?1:0,target:1,network:'XRP Ledger',block:t.ledger_index||'-',progress:ok?100:0}; }
async function xrpViaXrpscan(h){ const t=await json(`https://api.xrpscan.com/api/v1/tx/${encodeURIComponent(h)}`); const ok=t?.validated===true&&(t?.meta?.TransactionResult==='tesSUCCESS'||t?.engine_result==='tesSUCCESS'||!t?.meta?.TransactionResult); return {status:ok?'Confirmed':'Pending',confirmations:ok?1:0,target:1,network:'XRP Ledger',block:t?.ledger_index||t?.ledger||'-',progress:ok?100:0}; }
async function xrp(h){ return firstSuccess([()=>xrpViaDataApi(h),()=>xrpViaXrpscan(h)],'XRP APIs'); }
async function query(c,n,h){ const l=n.toLowerCase(); if(c==='BTC')return btc(h); if(c==='ETH')return blockscout(h,'Ethereum',c); if(c==='USDT')return l.includes('tron')?tron(h):l.includes('bep')?bsc(h):blockscout(h,'Ethereum (ERC20)',c); if(c==='BNB')return bsc(h); if(c==='SOL')return sol(h); if(c==='TRX')return tron(h); if(c==='XRP')return xrp(h); throw Error('This network is not available yet'); }
function setNextRefresh(text){ if($('next-refresh')) $('next-refresh').textContent=text; }
function updateLiveMeta(){ if(poller.lastUpdateMs){ const s=Math.max(0,Math.floor((Date.now()-poller.lastUpdateMs)/1000)); $('last-update').textContent=`${new Date(poller.lastUpdateMs).toLocaleTimeString()} (${s}s ago)`; } if(!poller.active) return; if(document.hidden){ setNextRefresh('Paused (tab hidden)'); return; } if(!poller.nextAt){ setNextRefresh('Waiting'); return; } const left=Math.max(0,Math.ceil((poller.nextAt-Date.now())/1000)); setNextRefresh(left===0?'Updating now…':`in ${left}s`); }
function startTicker(){ if(poller.ticker) clearInterval(poller.ticker); poller.ticker=setInterval(updateLiveMeta,1000); updateLiveMeta(); }
function stopTicker(){ if(!poller.active && poller.ticker){ clearInterval(poller.ticker); poller.ticker=null; } }
function stopPolling(reason){ poller.active=false; poller.context=null; poller.inFlight=false; poller.nextAt=0; if(poller.timer){ clearTimeout(poller.timer); poller.timer=null; } if(reason) setNextRefresh(reason); stopTicker(); }
function isFinal(result){ const target=Number(result.target || targets[poller.context?.coin] || 0); if(result.status==='Failed') return true; return result.status==='Confirmed' && Number(result.confirmations||0) >= target; }
function nextInterval(result){ const conf=Number(result.confirmations||0); const target=Number(result.target || targets[poller.context?.coin] || 0); if(conf<=0) return POLL_INTERVAL_INITIAL_MS; if(target>0 && conf>=Math.max(1,target-1)) return POLL_INTERVAL_NEAR_MS; return POLL_INTERVAL_MID_MS; }
function retryDelay(){ return Math.min(POLL_RETRY_BASE_MS * (2 ** Math.max(0,poller.retryCount-1)), POLL_RETRY_MAX_MS); }
function isFatal(err){ const m=String(err?.message||'').toLowerCase(); return m.includes('api 404') || m.includes('not available yet'); }
function scheduleNext(ms){ if(!poller.active) return; if(poller.timer) clearTimeout(poller.timer); if(document.hidden){ poller.nextAt=0; setNextRefresh('Paused (tab hidden)'); return; } poller.nextAt=Date.now()+Math.max(0,ms); poller.timer=setTimeout(runPoll,Math.max(0,ms)); updateLiveMeta(); }
async function runPoll(){
  if(!poller.active || document.hidden) return;
  if(Date.now()-poller.startMs>MAX_MONITORING_MS){
    stopPolling('Monitoring limit reached');
    $('transaction-status').textContent='Monitoring paused — refresh manually';
    $('status-pill').textContent='Idle';
    $('status-pill').className='status-pill';
    return;
  }
  if(poller.inFlight){ scheduleNext(2000); return; }
  poller.inFlight=true;
  const { coin:c, chain:n, hash:h } = poller.context;
  try{
    const result=await query(c,n,h);
    poller.retryCount=0;
    poller.lastUpdateMs=Date.now();
    render(result,c,n,h);
    if(isFinal(result)){ stopPolling('Monitoring complete'); return; }
    scheduleNext(nextInterval(result));
  }catch(err){
    console.error(err);
    if(isFatal(err)){
      render({status:'Failed',progress:0,confirmations:0,target:targets[c],network:n,block:'-'},c,n,h);
      stopPolling('Stopped (invalid hash / unsupported)');
      return;
    }
    poller.retryCount+=1;
    $('transaction-status').textContent=`Retrying after API error (${poller.retryCount})`;
    $('status-pill').textContent='Retrying';
    $('status-pill').className='status-pill retrying';
    scheduleNext(retryDelay());
  }finally{
    poller.inFlight=false;
  }
}
function startPolling(c,n,h){
  stopPolling('Replaced by new transaction');
  poller.active=true;
  poller.context={ coin:c, chain:n, hash:h };
  poller.startMs=Date.now();
  poller.retryCount=0;
  poller.lastUpdateMs=0;
  setNextRefresh('Starting…');
  startTicker();
  scheduleNext(0);
}
coin.addEventListener('change',updateChains); updateChains();
document.addEventListener('visibilitychange',()=>{ if(!poller.active) return; if(document.hidden){ if(poller.timer){ clearTimeout(poller.timer); poller.timer=null; } poller.nextAt=0; updateLiveMeta(); return; } scheduleNext(1000); });
form.addEventListener('submit',async e=>{ e.preventDefault(); const c=coin.value,n=chain.value,h=$('tx-hash').value.trim(); if(!h)return; button.disabled=true; button.textContent='Checking…'; render({status:'Pending',progress:0,confirmations:0,target:targets[c],network:n,block:'-'},c,n,h); startPolling(c,n,h); button.disabled=false; button.textContent='Check transaction'; });
