'use strict';
const test=require('node:test'),a=require('node:assert/strict'),t=require('./maintenance/native_trial.cjs'),v=require('./read_only/codec.cjs');
test('synthetic finite profile fixes scope, caps, timing and reserve',()=>{
 const p=t.profile(1000);a.equal(t.mandate(p,1001),p);a.equal(p.reserve_wei,'10000000000000000');
 for(const [k,x]of [['wallet',v.zeroAddress],['chain_id',56],['borrow_wei','500000000000001'],['hard_floor',1],['target_hf',3],['maximillion',v.zeroAddress]])a.throws(()=>t.mandate({...p,[k]:x},1001));
 a.throws(()=>t.mandate(p,p.expires_at));a.throws(()=>t.mandate({...p,extra:true},1001));
});
test('exact wire rejects unsafe numbers, units, missing booleans and accessors',()=>{
 for(const x of [9007199254740992,NaN,-1,true,'-1','01','1e18','1.1','',String(2n**256n)])a.throws(()=>t.uint(x));
 for(const x of ['true',1,null,undefined])a.throws(()=>t.bool(x));a.equal(t.uint('17940492450000000'),17940492450000000n);
 const p=t.profile(1000);Object.defineProperty(p,'wallet',{enumerable:true,get:()=>t.F.owner});a.throws(()=>t.mandate(p,1001));
});
test('synthetic source truncation yields bounded protection target',()=>{
 a.equal(t.weightedValue(200000n,10n**28n,8n*10n**17n,600n*10n**18n),960000000000000000n);
 a.equal(t.targetDebt(200000n,10n**28n,8n*10n**17n,600n*10n**18n,4),400000000000000n);
 a.throws(()=>t.targetDebt(1n,1n,1n,0n,4));
});
test('unsigned calldata fixes native routes and borrower, no execution',()=>{
 for(const s of t.STEPS){const d=t.draft(s,s==='SEED'?BigInt(t.LIMITS.seed_wei):1n);a.equal(d.authority,'NONE');a.equal(d.financial_ready,false);a.equal(d.signer_status,'NO_SIGNER');a.equal(d.tx.from,t.F.owner);a.equal(d.full_close_guaranteed,false);}
 a.equal(t.draft('PARTIAL_REPAY',42n).tx.data,'0x4e4d9fea');a.equal(t.draft('CLOSE',600000000000000n).tx.to,t.MAX);
 a.equal(t.draft('CLOSE',1n,'DIRECT_QUOTED').tx.to,t.F.vbnb);a.throws(()=>t.draft('BORROW',0n));a.throws(()=>t.draft('OTHER',1n));a.throws(()=>t.draft('BORROW',500000000000001n));a.throws(()=>t.draft('SEED',1n));a.throws(()=>t.draft('REDEEM',2000000000000001n));
});

function fixture(now=1000000){
 const markets=[...Array.from({length:48},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0')),t.F.vbnb];
 const core={kind:'SYNTHETIC',chain_id:97,wallet:t.F.owner,controller:t.F.controller,block_number:'100',block_hash:'0x'+'b'.repeat(64),block_timestamp:now,complete_core_observation:true,markets,assets_entered:[t.F.vbnb],controller_runtime_sha256:'e50073b83c179f3d4678efbde92b14d6160e589fc6f66c81c01fba4e41d42f8b',ledger:markets.map(market=>({market,status:'OBSERVED',vtoken_balance_raw:'0',stored_borrow_raw:'0',current_accrued_debt_raw:'0',exchange_rate_raw:'1',runtime_sha256:market===t.F.vbnb?t.F.pin:'a'.repeat(64)})),vai:{status:'OBSERVED',minted_vai_raw:'0',repay_amount_raw:'0'}};
 const row=core.ledger.find(x=>x.market===t.F.vbnb);row.vtoken_balance_raw='200000';row.exchange_rate_raw='10000000000000000000000000000';
 const n={kind:'SYNTHETIC',chain_id:97,wallet:t.F.owner,vbnb:t.F.vbnb,controller:t.F.controller,block_number:core.block_number,block_hash:core.block_hash,
 block_timestamp:now,quorum:true,reorg_checked:true,source_gate:'BOUND_FOR_NATIVE_TRIAL',native_balance_wei:'17940492450000000',exchange_rate_current_raw:row.exchange_rate_raw,
 cf_raw:'700000000000000000',lt_raw:'800000000000000000',collateral_price_raw:'600000000000000000000',debt_price_raw:'600000000000000000000',protocol_paused:false,
 pauses:[false,false,false,false],borrow_cap_raw:'100000000000000000000000',total_borrows_raw:'0',supply_cap_raw:'100000000000000000000000',total_supplied_raw:'0',cash_raw:'1000000000000000000',maximillion:t.MAX,max_runtime_sha256:'9acccb9295ecf800806820ca8b52f9cebcae32afc8541e3c8c59e39cedca10f8',max_vbnb:t.F.vbnb,controller_runtime_sha256:core.controller_runtime_sha256,native_runtime_sha256:t.F.pin};return{core,n,row};
}
test('synthetic all49 scope and VAI zero require canonical ledger and native source ratios',()=>{
 const x=fixture();a.equal(t.state(x.core,x.n,1000000).tokens,200000n);
 for(const edit of [x=>x.core.ledger[0].current_accrued_debt_raw='1',x=>x.core.ledger[0].status='UNKNOWN',x=>x.core.vai.repay_amount_raw='1',x=>x.core.markets.pop(),x=>x.core.assets_entered.push(x.core.markets[0]),x=>x.n.debt_price_raw='599000000000000000000',x=>x.n.quorum='true',x=>delete x.n.reorg_checked,x=>x.n.exchange_rate_current_raw=1,x=>x.n.cf_raw='0',x=>x.n.max_vbnb=v.zeroAddress,x=>x.n.max_runtime_sha256='a'.repeat(64),x=>x.n.block_hash='0x'+'a'.repeat(64)]){const y=fixture();edit(y);a.throws(()=>t.state(y.core,y.n,1000000));}
 a.throws(()=>t.state(x.core,x.n,1000121));a.throws(()=>t.state(x.core,x.n,999999));
});

function receipt(step,timestamp,amount,debt='0'){const i=t.STEPS.indexOf(step);return{kind:'SYNTHETIC',step,timestamp,tx_hash:'0x'+String(i+1).repeat(64),block_hash:'0x'+'c'.repeat(64),fee_wei:'100000000000000',amount_wei:amount,debt_after_wei:debt,confirmed:true,quorum_verified:true};}
test('synthetic finite five-step path uses real receipt anchors and measured debt target',()=>{
 const start=1000000,p=t.profile(start),seed=receipt('SEED',start,p.seed_wei),borrow=receipt('BORROW',start+10,p.borrow_wei,p.borrow_wei);
 let x=fixture(start);a.equal(t.plan(p,'SEED',x.core,x.n,[],start).status,'UNSIGNED_NATIVE_TRIAL');
 a.equal(t.plan(p,'BORROW',x.core,x.n,[seed],start).status,'UNSIGNED_NATIVE_TRIAL');
 x=fixture(start+86400);x.row.current_accrued_debt_raw=p.borrow_wei;
 const partial=t.plan(p,'PARTIAL_REPAY',x.core,x.n,[seed,borrow],start+86400);a.equal(partial.amount_wei,'100000000000000');a.equal(partial.expected_remaining_debt_wei,'400000000000000');
 const rp=receipt('PARTIAL_REPAY',start+86400,partial.amount_wei,partial.expected_remaining_debt_wei);x=fixture(start+172800);x.row.current_accrued_debt_raw='400000000000100';
 const close=t.plan(p,'CLOSE',x.core,x.n,[seed,borrow,rp],start+172800);a.equal(close.tx.to,t.MAX);a.equal(close.amount_wei,p.close_wei);a.equal(close.full_close_guaranteed,false);
 const rc=receipt('CLOSE',start+172800,p.close_wei);x.row.current_accrued_debt_raw='0';a.equal(t.plan(p,'REDEEM',x.core,x.n,[seed,borrow,rp,rc],start+172800).amount_wei,p.seed_wei);
});
test('native zero borrow cap and source/pause/reserve gaps stop before seed',()=>{
 const now=1000000,p=t.profile(now);
 for(const [edit,reason]of [[x=>x.n.borrow_cap_raw='0','BORROW_CAP_STOP'],[x=>x.n.source_gate='UNKNOWN','SOURCE_CALLGRAPH_UNKNOWN_STOP'],[x=>x.n.protocol_paused=true,'PROTOCOL_PAUSED_STOP'],[x=>x.n.pauses[0]=true,'PROTOCOL_PAUSED_STOP'],[x=>x.n.native_balance_wei='12999999999999999','RESERVE_GAS_STOP'],[x=>x.n.supply_cap_raw='1','SUPPLY_CAP_STOP']]){const x=fixture(now);edit(x);const r=t.plan(p,'SEED',x.core,x.n,[],now);a.equal(r.status,'STOP');a.equal(r.reason,reason);a.equal(r.financial_ready,false);}
});
test('hard floor, UTC anchors and already met HF prevent forced actions',()=>{
 const start=1000000,p=t.profile(start),seed=receipt('SEED',start,p.seed_wei),borrow=receipt('BORROW',start+1,p.borrow_wei,p.borrow_wei);let x=fixture(start);
 x.row.vtoken_balance_raw='10000';a.equal(t.plan(p,'BORROW',x.core,x.n,[seed],start).reason,'HARD_FLOOR_CASH_STOP');
 x=fixture(start+86399);x.row.current_accrued_debt_raw=p.borrow_wei;a.equal(t.plan(p,'PARTIAL_REPAY',x.core,x.n,[seed,borrow],start+86399).status,'WAIT');
 x=fixture(start+86400);x.row.current_accrued_debt_raw='300000000000000';a.equal(t.plan(p,'PARTIAL_REPAY',x.core,x.n,[seed,borrow],start+86400).reason,'TARGET_HF_ALREADY_MET');
 x=fixture(start+172799);a.equal(t.plan(p,'CLOSE',x.core,x.n,[seed,borrow],start+172799).status,'WAIT');
 x=fixture(start+86400);a.equal(t.plan(p,'BORROW',x.core,x.n,[seed],start+86400).reason,'DAY1_UTC_STOP');
});
test('finite ledger rejects duplicate, unconfirmed, future and excessive fee receipts',()=>{
 const now=1000000,p=t.profile(now),base=receipt('SEED',now,p.seed_wei);const x=fixture(now);
 for(const edit of [r=>r.confirmed=false,r=>r.quorum_verified='true',r=>r.timestamp=now+1,r=>r.amount_wei='2000000000000001',r=>r.debt_after_wei='1',r=>r.fee_wei='200000000000001',r=>r.extra=1]){const r={...base};edit(r);a.equal(t.plan(p,'BORROW',x.core,x.n,[r],now).status,'STOP');}
 a.equal(t.plan(p,'BORROW',x.core,x.n,[base,base],now).status,'STOP');a.equal(t.plan(p,'SEED',x.core,x.n,[base],now).reason,'STEP_ALREADY_RECEIPTED');
});
test('closing cap and zero debt gate block dust redeem, no quoted repayment guarantee',()=>{
 const start=1000000,now=start+172800,p=t.profile(start),rs=[receipt('SEED',start,p.seed_wei),receipt('BORROW',start+1,p.borrow_wei,p.borrow_wei)];let x=fixture(now);
 x.row.current_accrued_debt_raw='600000000000001';a.equal(t.plan(p,'CLOSE',x.core,x.n,rs,now).reason,'CLOSE_CAP_STOP');
 x.row.current_accrued_debt_raw='1';a.equal(t.plan(p,'REDEEM',x.core,x.n,rs,now).reason,'ZERO_DEBT_REQUIRED_STOP');
 x.row.current_accrued_debt_raw='0';a.equal(t.plan(p,'CLOSE',x.core,x.n,rs,now).reason,'NO_NATIVE_DEBT');
 a.equal(t.draft('CLOSE',1n,'DIRECT_QUOTED').full_close_guaranteed,false);
});
