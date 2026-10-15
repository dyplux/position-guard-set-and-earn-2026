'use strict';
/* Finite unsigned preparation. No signer, provider writes or authority grant. */
const v=require('../read_only/codec.cjs'),{F}=require('./native_reader.cjs');
const E=10n**18n,MAX='0xF3a34e06015e019D6154a0f1089f695B27122f50';
const LIMITS=Object.freeze({seed_wei:'2000000000000000',borrow_wei:'500000000000000',close_wei:'600000000000000',
 reserve_wei:'10000000000000000',aggregate_gas_wei:'1000000000000000',gas_limit:1000000,gas_price_wei:'200000000',hard_floor:2,target_hf:4});
const STEPS=Object.freeze(['SEED','BORROW','PARTIAL_REPAY','CLOSE','REDEEM']);
const SAFETY=Object.freeze({authority:'NONE',signer_status:'NO_SIGNER',execution_enabled:false,signing_ready:false,financial_ready:false,financial_source_review:false,real_actions:0});
function shape(x,keys){
 if(!x||typeof x!=='object'||Array.isArray(x)||![Object.prototype,null].includes(Object.getPrototypeOf(x)))throw Error('SHAPE_STOP');
 const own=Reflect.ownKeys(x);if(own.some(k=>typeof k!=='string')||own.slice().sort().join(',')!==keys.slice().sort().join(','))throw Error('SHAPE_STOP');
 for(const k of own){const d=Object.getOwnPropertyDescriptor(x,k);if(!d.enumerable||!('value'in d))throw Error('SHAPE_STOP');}
}
function uint(x){if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(x)||BigInt(x)>=2n**256n)throw Error('UINT_STOP');return BigInt(x);}
function time(x){if(!Number.isSafeInteger(x)||x<0)throw Error('TIME_STOP');return x;}
function hash(x){if(typeof x!=='string'||!/^0x[0-9a-f]{64}$/.test(x))throw Error('HASH_STOP');return x;}
function bool(x){if(typeof x!=='boolean')throw Error('BOOLEAN_STOP');return x;}
function profile(issued){time(issued);time(issued+5*86400);return{version:1,id:'NativeOnlyTestProfileV1',chain_id:97,wallet:F.owner,vbnb:F.vbnb,controller:F.controller,
 maximillion:MAX,issued_at:issued,expires_at:issued+5*86400,test_assumption:'SAME_NATIVE_PRICE_RATIO_WITH_SOURCE_TRUNCATION',...LIMITS};}
function mandate(p,now){
 shape(p,Object.keys(profile(0)));time(now);time(p.issued_at);time(p.expires_at);
 const expected=profile(p.issued_at);for(const k of Object.keys(expected))if(p[k]!==expected[k])throw Error('PROFILE_BINDING_STOP');
 if(p.issued_at>now||p.expires_at<=now)throw Error('PROFILE_EXPIRED_STOP');return p;
}
function weightedValue(tokens,exchange,factor,price){return (factor*exchange/E*price/E)*tokens/E;}
function targetDebt(tokens,exchange,factor,price,target){
 if(price<=0n||factor<=0n||factor>E||!Number.isSafeInteger(target)||target<2)throw Error('RATIO_STOP');
 return weightedValue(tokens,exchange,factor,price)/BigInt(target)*E/price;
}
function draft(step,amount,route='MAXIMILLION'){
 if(!STEPS.includes(step)||typeof amount!=='bigint'||amount<=0n||amount>=2n**256n)throw Error('DRAFT_STOP');
 const cap=BigInt(step==='SEED'||step==='REDEEM'?LIMITS.seed_wei:step==='BORROW'?LIMITS.borrow_wei:LIMITS.close_wei);
 if(amount>cap||step==='SEED'&&amount!==cap)throw Error('DRAFT_CAP_STOP');
 let signature,args=[],to=F.vbnb,value=0n;
 if(step==='SEED'){signature='function mint() payable';value=amount;}
 if(step==='BORROW'){signature='function borrow(uint256) returns(uint256)';args=[amount];}
 if(step==='PARTIAL_REPAY'){signature='function repayBorrow() payable';value=amount;}
 if(step==='CLOSE'){
  if(route==='MAXIMILLION'){to=MAX;signature='function repayBehalf(address) payable';args=[F.owner];}
  else if(route==='DIRECT_QUOTED')signature='function repayBorrow() payable';else throw Error('ROUTE_STOP');value=amount;
 }
 if(step==='REDEEM'){signature='function redeemUnderlying(uint256) returns(uint256)';args=[amount];}
 const abi=v.parseAbi([signature]);return{...SAFETY,status:'UNSIGNED_NATIVE_TRIAL',step,amount_wei:amount.toString(),
 full_close_guaranteed:false,requires_zero_debt_before_redeem:true,chain_id:97,tx:{from:F.owner,to,value:'0x'+value.toString(16),
 data:v.encodeFunctionData({abi,functionName:abi[0].name,args}),gas:LIMITS.gas_limit,gas_price_wei:LIMITS.gas_price_wei},
 required_checks:['fresh two-RPC full Core/VAI scope','source and selector bindings','admission/pause/caps','exact latest simulation and gas','reserve','canonical receipt and effects']};
}
const NATIVE_KEYS=['kind','chain_id','wallet','vbnb','controller','block_number','block_hash','block_timestamp','quorum','reorg_checked','source_gate',
 'native_balance_wei','exchange_rate_current_raw','cf_raw','lt_raw','collateral_price_raw','debt_price_raw','protocol_paused','pauses',
 'borrow_cap_raw','total_borrows_raw','supply_cap_raw','total_supplied_raw','cash_raw','maximillion','max_runtime_sha256','max_vbnb','controller_runtime_sha256','native_runtime_sha256'];
function state(core,n,now){
 shape(n,NATIVE_KEYS);time(now);time(n.block_timestamp);time(core.block_timestamp);
 if(!['OBSERVED','SYNTHETIC'].includes(n.kind)||core.kind!==n.kind||core.chain_id!==97||n.chain_id!==97
  ||core.wallet!==F.owner||n.wallet!==F.owner||core.controller!==F.controller||n.controller!==F.controller||n.vbnb!==F.vbnb)throw Error('SCOPE_STOP');
 hash(core.block_hash);hash(n.block_hash);uint(core.block_number);uint(n.block_number);
 if(core.block_hash!==n.block_hash||core.block_number!==n.block_number||core.block_timestamp!==n.block_timestamp
  ||now<n.block_timestamp||now-n.block_timestamp>120||bool(n.quorum)!==true||bool(n.reorg_checked)!==true)throw Error('FRESH_QUORUM_STOP');
 if(bool(core.complete_core_observation)!==true||!Array.isArray(core.markets)||core.markets.length!==49||!Array.isArray(core.ledger)
  ||core.ledger.length!==49||new Set(core.markets.map(x=>x.toLowerCase())).size!==49)throw Error('CORE_SCOPE_STOP');
 if(!Array.isArray(core.assets_entered)||core.assets_entered.length!==1||core.assets_entered[0]!==F.vbnb)throw Error('ENTERED_SCOPE_STOP');
 let position;
 for(const market of core.markets){
  if(typeof market!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(market)||/^0x0{40}$/i.test(market))throw Error('MARKET_STOP');
  const rows=core.ledger.filter(x=>typeof x.market==='string'&&x.market.toLowerCase()===market.toLowerCase());
  if(rows.length!==1||rows[0].status!=='OBSERVED')throw Error('LEDGER_UNKNOWN_STOP');const row=rows[0];
  const current=uint(row.current_accrued_debt_raw),stored=uint(row.stored_borrow_raw);uint(row.vtoken_balance_raw);
  if(current<stored||uint(row.exchange_rate_raw)===0n)throw Error('LEDGER_STOP');
  if(market.toLowerCase()===F.vbnb.toLowerCase())position=row;else if(current!==0n||stored!==0n)throw Error('OTHER_DEBT_STOP');
 }
 if(!position||core.vai?.status!=='OBSERVED'||uint(core.vai.minted_vai_raw)!==0n||uint(core.vai.repay_amount_raw)!==0n)throw Error('VAI_SCOPE_STOP');
 if(n.native_runtime_sha256!==F.pin||position.runtime_sha256!==F.pin||n.controller_runtime_sha256!==core.controller_runtime_sha256
  ||n.controller_runtime_sha256!=='e50073b83c179f3d4678efbde92b14d6160e589fc6f66c81c01fba4e41d42f8b')throw Error('RUNTIME_STOP');
 if(n.maximillion!==MAX||n.max_vbnb!==F.vbnb||n.max_runtime_sha256!=='9acccb9295ecf800806820ca8b52f9cebcae32afc8541e3c8c59e39cedca10f8')throw Error('MAX_BINDING_STOP');
 if(!['BOUND_FOR_NATIVE_TRIAL','UNKNOWN'].includes(n.source_gate))throw Error('SOURCE_STATUS_STOP');
 if(!Array.isArray(n.pauses)||n.pauses.length!==4)throw Error('PAUSE_STOP');n.pauses.forEach(bool);bool(n.protocol_paused);
 const out={};for(const k of NATIVE_KEYS.filter(k=>k.endsWith('_raw')||k.endsWith('_wei')))out[k]=uint(n[k]);
 if(out.exchange_rate_current_raw===0n||out.cf_raw===0n||out.cf_raw>E||out.lt_raw===0n||out.lt_raw>E
  ||out.collateral_price_raw===0n||out.collateral_price_raw!==out.debt_price_raw)throw Error('PRICE_FACTOR_STOP');
 return{...out,tokens:uint(position.vtoken_balance_raw),debt:uint(position.current_accrued_debt_raw),kind:n.kind,block_timestamp:n.block_timestamp};
}
function history(rows,kind,now){
 if(!Array.isArray(rows)||rows.length>5)throw Error('HISTORY_STOP');let prior=-1,stamp=0,fees=0n;const hashes=new Set();
 for(const r of rows){
  shape(r,['kind','step','timestamp','tx_hash','block_hash','fee_wei','amount_wei','debt_after_wei','confirmed','quorum_verified']);
  const index=STEPS.indexOf(r.step);time(r.timestamp);hash(r.tx_hash);hash(r.block_hash);const fee=uint(r.fee_wei),amount=uint(r.amount_wei),debt=uint(r.debt_after_wei);
  if(r.kind!==kind||index<=prior||r.timestamp<stamp||r.timestamp>now||bool(r.confirmed)!==true||bool(r.quorum_verified)!==true
   ||hashes.has(r.tx_hash)||fee>BigInt(LIMITS.gas_limit)*BigInt(LIMITS.gas_price_wei)||debt>BigInt(LIMITS.close_wei))throw Error('HISTORY_STOP');
  draft(r.step,amount);if(['SEED','CLOSE','REDEEM'].includes(r.step)&&debt!==0n)throw Error('RECEIPT_EFFECT_STOP');
  hashes.add(r.tx_hash);prior=index;stamp=r.timestamp;fees+=fee;
 }
 if(fees>BigInt(LIMITS.aggregate_gas_wei))throw Error('GAS_AGGREGATE_STOP');return fees;
}
const utc=t=>Math.floor(t/86400);
function plan(p,step,core,n,receipts=[],now=Math.floor(Date.now()/1000)){
 const result=(status,reason)=>({...SAFETY,status,reason,step,oracle_freshness:'UNKNOWN',complete_position:false});
 try{
  mandate(p,now);if(!STEPS.includes(step))throw Error('STEP_STOP');const s=state(core,n,now),spent=history(receipts,s.kind,now);
  const previous=k=>receipts.find(r=>r.step===k),seed=previous('SEED'),borrow=previous('BORROW'),closed=previous('CLOSE');
  if(previous(step))return result('NO_ACTION','STEP_ALREADY_RECEIPTED');
  if(receipts.length&&STEPS.indexOf(step)<=STEPS.indexOf(receipts.at(-1).step))throw Error('STEP_ORDER_STOP');
  if(step!=='SEED'&&!seed||!['SEED','BORROW'].includes(step)&&!borrow)throw Error('PREDECESSOR_STOP');
  if(step==='SEED'&&receipts.length||['SEED','BORROW'].includes(step)&&s.debt!==0n)throw Error('PREEXISTING_DEBT_STOP');
  if(step==='BORROW'&&utc(now)!==utc(seed.timestamp))throw Error('DAY1_UTC_STOP');
  if(step==='PARTIAL_REPAY'&&(now<seed.timestamp+86400||utc(now)<=utc(seed.timestamp)))return result('WAIT','DAY2_NOT_REACHED');
  if(['CLOSE','REDEEM'].includes(step)&&(now<seed.timestamp+172800||utc(now)<=utc(seed.timestamp)+1))return result('WAIT','DAY3_NOT_REACHED');
  if(step==='REDEEM'&&closed&&utc(now)!==utc(closed.timestamp))throw Error('DAY3_UTC_STOP');
  if(n.protocol_paused||n.pauses[{SEED:0,REDEEM:1,BORROW:2,PARTIAL_REPAY:3,CLOSE:3}[step]])throw Error('PROTOCOL_PAUSED_STOP');
  if(['SEED','BORROW'].includes(step)&&(s.borrow_cap_raw===0n||s.total_borrows_raw+BigInt(p.borrow_wei)>s.borrow_cap_raw))throw Error('BORROW_CAP_STOP');
  if(n.source_gate!=='BOUND_FOR_NATIVE_TRIAL')throw Error('SOURCE_CALLGRAPH_UNKNOWN_STOP');
  let amount;
  if(step==='SEED'){amount=BigInt(p.seed_wei);if(s.supply_cap_raw===0n||s.total_supplied_raw+amount>s.supply_cap_raw)throw Error('SUPPLY_CAP_STOP');}
  if(step==='BORROW'){
   amount=BigInt(p.borrow_wei);const factor=s.cf_raw<s.lt_raw?s.cf_raw:s.lt_raw;
   if(amount>targetDebt(s.tokens,s.exchange_rate_current_raw,factor,s.debt_price_raw,p.hard_floor)||s.cash_raw<amount)throw Error('HARD_FLOOR_CASH_STOP');
  }
  if(step==='PARTIAL_REPAY'){
   const desired=targetDebt(s.tokens,s.exchange_rate_current_raw,s.lt_raw,s.debt_price_raw,p.target_hf);
   if(s.debt<=desired)return result('NO_ACTION','TARGET_HF_ALREADY_MET');amount=s.debt-desired;
   if(amount>=s.debt)throw Error('PARTIAL_MUST_LEAVE_DEBT_STOP');
  }
  if(step==='CLOSE'){if(s.debt===0n)return result('NO_ACTION','NO_NATIVE_DEBT');if(s.debt>BigInt(p.close_wei))throw Error('CLOSE_CAP_STOP');amount=BigInt(p.close_wei);}
  if(step==='REDEEM'){
   if(s.debt!==0n)throw Error('ZERO_DEBT_REQUIRED_STOP');amount=uint(seed.amount_wei);
   if(amount>s.tokens*s.exchange_rate_current_raw/E||s.cash_raw<amount)throw Error('REDEEM_CAP_CASH_STOP');
  }
  const proposal=draft(step,amount),nextFee=BigInt(p.gas_limit)*BigInt(p.gas_price_wei),remaining=BigInt(p.aggregate_gas_wei)-spent;
  if(nextFee>remaining||s.native_balance_wei<BigInt(p.reserve_wei)+remaining+BigInt(proposal.tx.value))throw Error('RESERVE_GAS_STOP');
  return{...proposal,kind:s.kind,profile_id:p.id,profile_expires_at:p.expires_at,block_hash:core.block_hash,oracle_freshness:'UNKNOWN',complete_position:false,
   expected_remaining_debt_wei:step==='PARTIAL_REPAY'?(s.debt-amount).toString():null,postconditions:step==='CLOSE'?['canonical receipt','fresh two-RPC native debt exactly zero','refund to F9']:['canonical receipt','fresh two-RPC effects'],
   dates_from_receipt_utc:seed?{day1:utc(seed.timestamp),day2_not_before:seed.timestamp+86400,day3_not_before:seed.timestamp+172800}:null};
 }catch(e){return result('STOP',/^[A-Z0-9_]+$/.test(e.message)?e.message:'INPUT_STOP');}
}
module.exports={F,MAX,LIMITS,STEPS,SAFETY,shape,uint,time,hash,bool,profile,mandate,weightedValue,targetDebt,draft,state,history,plan};
