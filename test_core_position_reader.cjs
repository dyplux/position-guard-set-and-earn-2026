'use strict';
/* Fixtures below are synthetic observations, never financial source proof. */
const{test}=require('node:test'),assert=require('node:assert/strict');
const{observeCore,marketList,decode,ALLOWED,CORE,coreRpc,LEGACY}=require('./maintenance/core_position_reader.cjs');
const{F,URLS}=require('./maintenance/native_reader.cjs'),r=require('./read_only/rpc.cjs'),v=require('./read_only/codec.cjs');
const markets=[F.vbnb,...Array.from({length:48},(_,i)=>v.getAddress('0x'+(i+1).toString(16).padStart(40,'0')))];
// Public runtime fixtures captured at block136830371, compressed to keep the test portable.
const legacyCode=JSON.parse(require('node:zlib').gunzipSync(Buffer.from('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','base64')).toString());
const pin=r.sha256Code('0x6000');
function mock(options={}){
 const calls=[];let headers=0;
 const request=async(url,method,params=[])=>{
  calls.push({url,method,params});
  if(method==='eth_blockNumber')return options.head||'0x64';
  if(method==='eth_chainId')return options.chain||'0x61';
  if(method==='eth_getCode'){
   const target=params[0].toLowerCase();
   if(target===LEGACY.implementation.toLowerCase())return legacyCode.implementation+(options.legacyImplCodeMismatch?'00':'');
   if(LEGACY.proxies[target])return legacyCode.proxies[target]+(options.legacyCodeMismatch?'00':'');
   return options.emptyCode&&params[0]===markets[1]?'0x':'0x6000';
  }
  if(method==='eth_getBlockByNumber')return{number:params[0],hash:'0x'+(options.reorg&&++headers>2?'b':'a').repeat(64),timestamp:'0x3e8'};
  if(method==='eth_call'){
   assert.equal(params.length,2);const to=params[0].to,data=params[0].data;
   const oracle='0x3cD69251D04A28d887Ac14cbe2E14c52F3D57823',feed='0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526';
   const snapshotABI=v.parseAbi(['function getAccountSnapshot(address) view returns(uint256,uint256,uint256,uint256)']);
   const snapshotCall=v.encodeFunctionData({abi:snapshotABI,functionName:'getAccountSnapshot',args:[F.owner]});
   const inner=v.encodeFunctionResult({abi:snapshotABI,functionName:'getAccountSnapshot',result:[0n,options.legacyDifference&&url.includes('publicnode')?2n:1n,0n,100n]})+(options.legacyInnerPadding?'00'.repeat(64):'');
   const specifications=[['function implementation() view returns(address)',[],options.legacyImplMismatch?markets[1]:LEGACY.implementation],
    ['function delegateToViewImplementation(bytes) view returns(bytes)',[snapshotCall],inner],['function vaiController() view returns(address)',[],CORE.vai],
    ['function mintedVAIs(address) view returns(uint256)',[F.owner],BigInt(options.vaiDebt||0)],
    ['function getVAIRepayAmount(address) view returns(uint256)',[F.owner],BigInt(options.vaiRepay||options.vaiDebt||0)],
    ['function oracle() view returns(address)',[],oracle],
    ['function nativeMarket() view returns(address)',[],F.vbnb],
    ['function paused() view returns(bool)',[],false],
    ['function getTokenConfig(address) view returns(address,address[3],bool[3],bool)',[CORE.native],[CORE.native,[CORE.mainAdapter,'0x'+'0'.repeat(40),'0x'+'0'.repeat(40)],[true,false,false],false]],
    ['function getOracle(address,uint8) view returns(address,bool)',[CORE.native,0],[CORE.mainAdapter,true]],
    ['function prices(address) view returns(uint256)',[CORE.native],options.feed?0n:600n*10n**18n],
    ['function getUnderlyingPrice(address) view returns(uint256)',[F.vbnb],600n*10n**18n],
    ['function tokenConfigs(address) view returns(address,address,uint256)',[CORE.native],[CORE.native,feed,86400n]],
    ['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)',[],[1n,600n*10n**8n,900n,900n,1n]],
    ['function decimals() view returns(uint8)',[],8],['function getAllMarkets() view returns(address[])',[],options.markets||markets],
    ['function getAssetsIn(address) view returns(address[])',[F.owner],[F.vbnb]],
    ['function comptroller() view returns(address)',[],options.foreignController&&to===markets[1]?markets[2]:F.controller],
    ['function getAccountSnapshot(address) view returns(uint256,uint256,uint256,uint256)',[F.owner],[0n,1n,to===markets[1]&&options.ercDebt?4n:0n,100n]],
    ['function borrowBalanceCurrent(address) returns(uint256)',[F.owner],to===markets[1]?BigInt(options.ercDebt||0):0n]];
   for(const[signature,args,result]of specifications){const abi=v.parseAbi([signature]),fn=abi[0].name;
    if(data===v.encodeFunctionData({abi,functionName:fn,args})){
     if((options.failure||options.oneFailure&&url.includes('publicnode'))&&to===markets[1])throw Error('RPC_FAILURE');
     if(options.vaiFailure&&to===CORE.vai)throw Error('VAI_RPC_FAILURE');
     if(options.legacyOuterPadding&&fn==='delegateToViewImplementation')return v.encodeFunctionResult({abi,functionName:fn,result})+'00'.repeat(32);
     if(options.paddedSnapshot&&to===markets[1]&&fn==='getAccountSnapshot')return v.encodeFunctionResult({abi,functionName:fn,result})+'00'.repeat(64);
     if(options.badSnapshot&&to===markets[1]&&fn==='getAccountSnapshot')return '0x00';
     if(options.decreasedDebt&&to===markets[1]&&fn==='borrowBalanceCurrent')return v.encodeFunctionResult({abi,functionName:fn,result:3n});
     const changed=options.difference&&url.includes('publicnode')&&fn==='borrowBalanceCurrent'&&to===markets[1]?1n:result;
     return v.encodeFunctionResult({abi,functionName:fn,result:changed});
    }
   }
  }
  throw Error('UNEXPECTED_MOCK_CALL');
 };return {request,calls};
}
async function run(options={}){const source=mock(options),result=await observeCore({request:source.request,clock:()=>1000,expectedPin:pin});return {...source,result};}
test('49 market synthetic ledger is bounded and uses per-market raw units',async()=>{
 const x=await run();assert.equal(x.result.status,'CORE_OBSERVATIONAL_ONLY');assert.equal(x.result.complete_core_market_observation,true);
 assert.equal(x.result.ledger.length,49);assert.equal(x.result.ledger[0].unit,'NATIVE_WEI');assert.equal(x.result.ledger[1].unit,'UNDERLYING_RAW_OF_MARKET');
 assert.equal(x.result.financial_ready,false);assert.equal(x.result.signer_status,'NO_SIGNER');assert.equal(x.result.complete_position,false);
 assert.ok(x.calls.every(c=>ALLOWED.has(c.method)));assert.equal(x.result.costs.concurrency_per_provider,8);
});
test('global registry rejects duplicate zero invalid empty and overflow lists',async()=>{
 for(const list of [[F.vbnb,F.vbnb],['0x'+'0'.repeat(40)],['bad'],[],Array(65).fill(F.vbnb)])assert.throws(()=>marketList(list));
 for(const list of [[F.vbnb,F.vbnb],['bad'],Array(65).fill(F.vbnb)])assert.equal((await run({markets:list})).result.status,'CORE_OBSERVER_STOP');
});
test('ERC20 positive debt remains in its own raw ledger',async()=>{
 const x=await run({ercDebt:5});assert.equal(x.result.ledger[1].current_accrued_debt_raw,'5');assert.equal(x.result.ledger[0].current_accrued_debt_raw,'0');
 assert.equal(x.result.total_debt,undefined);
});
test('failed getter code or market identity is UNKNOWN and never zero',async()=>{
 for(const options of [{failure:true},{emptyCode:true},{foreignController:true}]){
  const x=await run(options);assert.equal(x.result.status,'CORE_PARTIAL_UNKNOWN');assert.equal(x.result.complete_core_market_observation,false);
  assert.equal(x.result.ledger[1].status,'UNKNOWN');assert.equal(x.result.ledger[1].current_accrued_debt_raw,null);
 }
});
test('one provider difference, common block reorg, wrong chain and unsafe wire stop',async()=>{
 for(const options of [{difference:true},{reorg:true},{chain:'0x38'},{head:9007199254740992}])assert.equal((await run(options)).result.status,'CORE_OBSERVER_STOP');
 assert.throws(()=>decode('function borrowBalanceCurrent(address) returns(uint256)','0x00'));
 await assert.rejects(()=>observeCore({clock:'1000'}));await assert.rejects(()=>observeCore({expectedPin:pin}));
});

test('VAI debt is a separate stored-index getter, never summed with market debts',async()=>{
 const x=await run({vaiDebt:7,vaiRepay:9});assert.equal(x.result.complete_core_observation,true);
 assert.equal(x.result.vai.minted_vai_raw,'7');assert.equal(x.result.vai.repay_amount_raw,'9');
 assert.equal(x.result.vai.unit,'VAI_RAW');assert.equal(x.result.vai.current_accrual_verified,false);
 assert.equal(x.result.vai.accrual_semantics,'STORED_VAI_MINT_INDEX_GETTER');
 assert.equal(x.result.ledger[0].current_accrued_debt_raw,'0');assert.equal(x.result.total_debt,undefined);
});
test('direct override has no timestamp; feed path never raises freshness or financial flags',async()=>{
 const direct=(await run()).result,feed=(await run({feed:true})).result;
 assert.equal(direct.oracle.price_source_mode,'DIRECT_OVERRIDE_WITHOUT_TIMESTAMP');assert.equal(direct.oracle.native_price_raw,'600000000000000000000');
 assert.equal(direct.oracle.effective_price_updated_at,null);assert.equal(direct.oracle.feed_observation,undefined);
 assert.equal(feed.oracle.price_source_mode,'FEED_PATH_OBSERVED_FRESHNESS_UNKNOWN');assert.equal(feed.oracle.effective_price_updated_at,null);assert.equal(feed.oracle.feed_observation.updated_at,'900');
 for(const x of [direct,feed]){assert.equal(x.oracle.freshness,'UNKNOWN');assert.equal(x.oracle_freshness,'UNKNOWN');assert.equal(x.financial_source_review,false);assert.equal(x.financial_ready,false);}
});
test('expired common block or deadline cannot mark complete observation',async()=>{
 const source=mock();
 const stale=await observeCore({request:source.request,clock:()=>1031,expectedPin:pin});assert.equal(stale.status,'CORE_OBSERVER_STOP');
 let ticks=0;const expired=await observeCore({request:source.request,clock:()=>++ticks>5?1031:1000,expectedPin:pin});
 assert.equal(expired.status,'CORE_OBSERVER_STOP');assert.equal(expired.complete_core_observation,false);
 await assert.rejects(()=>observeCore({request:source.request,clock:()=>Number.MAX_SAFE_INTEGER+1,expectedPin:pin}));
});

test('oneRPC failure never becomes a zero debt; mixed ABI and accrued inconsistencies stay UNKNOWN',async()=>{
 const one=(await run({oneFailure:true})).result;assert.equal(one.status,'CORE_OBSERVER_STOP');assert.equal(one.ledger,null);
 for(const changes of [{paddedSnapshot:true},{badSnapshot:true},{ercDebt:4,decreasedDebt:true}]){
  const x=(await run(changes)).result;assert.equal(x.status,'CORE_PARTIAL_UNKNOWN');
  assert.equal(x.ledger[1].status,'UNKNOWN');assert.equal(x.ledger[1].current_accrued_debt_raw,null);
  if(changes.paddedSnapshot)assert.equal(x.ledger[1].read_observations.accrued_getter_raw,'0');
 }
});
test('VAI failed getter leaves separate debt unknown and completeness false',async()=>{
 const x=(await run({vaiFailure:true})).result;assert.equal(x.vai.status,'UNKNOWN');assert.equal(x.vai.repay_amount_raw,null);
 assert.equal(x.complete_core_observation,false);assert.equal(x.complete_core_market_observation,true);
});
test('native runtime pin, raw scalar type and extra input cannot weaken production guards',async()=>{
 const source=mock();const x=await observeCore({request:source.request,clock:()=>1000,expectedPin:r.sha256Code('0x6001')});
 assert.equal(x.ledger[0].status,'UNKNOWN');assert.equal(x.complete_core_observation,false);
 for(const data of [0,true,NaN,null,'0x'+'00'.repeat(64)])assert.throws(()=>decode('function borrowBalanceCurrent(address) returns(uint256)',data));
 await assert.rejects(()=>observeCore({request:source.request,clock:()=>true,expectedPin:pin}));
 await assert.rejects(()=>observeCore({request:source.request,clock:()=>1000,expectedPin:pin,stateOverrides:{}}));
});

test('local mocked fetch keeps fixedURL, rejects redirects and accepts exact RPC envelope',async()=>{
 const original=global.fetch;
 try{
  let calls=0;
  global.fetch=async(url,options)=>{
   calls++;assert.equal(url,URLS[0]);assert.equal(options.redirect,'error');
   const request=JSON.parse(options.body);assert.equal(request.method,'eth_chainId');
   return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:'0x61'}));
  };
  assert.equal(await coreRpc(URLS[0],'eth_chainId',[],performance.now()+1000),'0x61');
  await assert.rejects(()=>coreRpc('https://unapproved.example','eth_chainId',[],performance.now()+1000));
  await assert.rejects(()=>coreRpc(URLS[0],'eth_sendRawTransaction',['0x'],performance.now()+1000));
  assert.equal(calls,1);
  global.fetch=async()=>({redirected:true,ok:true});
  await assert.rejects(()=>coreRpc(URLS[0],'eth_chainId',[],performance.now()+1000),/RPC_REDIRECT_STOP/);
 }finally{global.fetch=original;}
});
test('local mocked fetch rejects duplicate keys, nonfinite JSON and invalid RPC envelopes',async()=>{
 const original=global.fetch;
 const bodies=[id=>`{"jsonrpc":"2.0","id":999,"id":${id},"result":"0x61"}`,
  id=>`{"jsonrpc":"2.0","id":${id},"result":"bad","result":"0x61"}`,
  id=>`{"jsonrpc":"2.0","id":${id},"result":{"same":1,"same":2}}`,
  id=>`{"jsonrpc":"2.0","id":${id},"\\u0069d":${id},"result":"0x61"}`,
  id=>`{"jsonrpc":"1.0","id":${id},"result":"0x61"}`,
  id=>`{"id":${id},"result":"0x61"}`,
  id=>`{"jsonrpc":"2.0","id":${id+1},"result":"0x61"}`,
  ...['null','false','0'].map(error=>id=>`{"jsonrpc":"2.0","id":${id},"error":${error},"result":"0x61"}`),
  ...['NaN','Infinity','1e400'].map(value=>id=>`{"jsonrpc":"2.0","id":${id},"result":${value}}`)];
 try{
  for(const body of bodies){
   global.fetch=async(_,options)=>new Response(body(JSON.parse(options.body).id));
   await assert.rejects(()=>coreRpc(URLS[0],'eth_chainId',[],performance.now()+1000));
  }
 }finally{global.fetch=original;}
});

test('all ten pinned legacy wrappers use canonical inner snapshot with separate source profile',async()=>{
 const registry=[F.vbnb,...Object.keys(LEGACY.proxies).map(x=>v.getAddress(x)),...markets.slice(1,39)];
 assert.equal(registry.length,49);const x=await run({markets:registry});
 assert.equal(x.result.status,'CORE_OBSERVATIONAL_ONLY',x.result.reason||JSON.stringify(x.result.ledger.filter(x=>x.status!=='OBSERVED')));assert.equal(x.result.complete_core_observation,true);
 assert.equal(x.result.ledger.filter(m=>m.snapshot_source==='LEGACY_CANONICAL_INNER_4UINT').length,10);
 assert.equal(x.result.financial_ready,false);assert.equal(x.result.financial_source_review,false);
 const viewSelector=v.toFunctionSelector('delegateToViewImplementation(bytes)');
 assert.equal(x.calls.filter(c=>c.method==='eth_call'&&c.params[0].data.startsWith(viewSelector)).length,20);
});
test('legacy code, implementation and canonical outer/inner bindings reject tampering',async()=>{
 const registry=[F.vbnb,v.getAddress(Object.keys(LEGACY.proxies)[0])];
 for(const change of [{legacyCodeMismatch:true},{legacyImplMismatch:true},{legacyImplCodeMismatch:true},
  {legacyInnerPadding:true},{legacyOuterPadding:true}]){
  const x=(await run({...change,markets:registry})).result;assert.equal(x.status,'CORE_PARTIAL_UNKNOWN');
  assert.equal(x.ledger[1].status,'UNKNOWN');assert.equal(x.complete_core_observation,false);
 }
 const difference=(await run({markets:registry,legacyDifference:true})).result;
 assert.equal(difference.status,'CORE_OBSERVER_STOP');assert.equal(difference.reason,'QUORUM_STOP');
});
test('profiles are immutable and compatibility cannot be injected through reader options',async()=>{
 assert.equal(Object.isFrozen(LEGACY),true);assert.equal(Object.isFrozen(LEGACY.proxies),true);
 await assert.rejects(()=>observeCore({legacyProfiles:{},request:mock().request,clock:()=>1000,expectedPin:pin}));
});
