'use strict';
const r=require('../read_only/rpc.cjs'),v=require('../read_only/codec.cjs');
const F=Object.freeze({owner:'0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982',vbnb:'0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c',controller:'0x94d1820b2D1c7c7452A163983Dc888CEC546b77D',pin:'551f3372553aa792ee3e80a21b4916904b23913759868d72e383204be598dc1c'});
const URLS=Object.freeze(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);
const systemClock=()=>Math.floor(Date.now()/1000),stable=x=>JSON.stringify(x,(_,n)=>typeof n==='bigint'?n.toString():n);
async function observe({request=r.rpc,clock=systemClock,expectedPin=F.pin}={}){
 if(typeof request!=='function'||typeof clock!=='function'||! /^[a-f0-9]{64}$/.test(expectedPin))throw Error('DEPENDENCIES_STOP');
 if(request===r.rpc&&expectedPin!==F.pin)throw Error('PRODUCTION_PIN_STOP');
 const initial=clock();if(!Number.isSafeInteger(initial)||initial<=0)throw Error('CLOCK_STOP');
 const heads=await Promise.all(URLS.map(u=>request(u,'eth_blockNumber'))),height=heads.map(r.quantity).reduce((a,b)=>a<b?a:b),block='0x'+height.toString(16);
 const rows=await Promise.all(URLS.map(async url=>{
  const q=(m,p=[])=>request(url,m,p),h=r.validateHeader(await q('eth_getBlockByNumber',[block,false]),block);
  if(r.quantity(await q('eth_chainId'))!==97n||r.sha256Code(await q('eth_getCode',[F.vbnb,block]))!==expectedPin)throw Error('CHAIN_OR_PIN_STOP');
  async function read(sig,args=[],to=F.vbnb){const abi=v.parseAbi([sig]),name=abi[0].name;return v.decodeFunctionResult({abi,functionName:name,data:await q('eth_call',[{to,data:v.encodeFunctionData({abi,functionName:name,args})},block])});}
  const a=await read('function getAccountSnapshot(address) view returns(uint256,uint256,uint256,uint256)',[F.owner]);
  const current=await read('function borrowBalanceCurrent(address) returns(uint256)',[F.owner]);
  const controller=await read('function comptroller() view returns(address)');
  if(!Array.isArray(a)||a.length!==4||a.some(n=>typeof n!=='bigint'||n<0n)||a[0]!==0n||typeof current!=='bigint'||current<a[2]||a[3]===0n||controller.toLowerCase()!==F.controller.toLowerCase())throw Error('NATIVE_POSITION_STOP');
  const assets=await read('function getAssetsIn(address) view returns(address[])',[F.owner],F.controller);
  if(!Array.isArray(assets)||assets.length>64||assets.some(a=>typeof a!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(a)||/^0x0{40}$/i.test(a))||new Set(assets.map(a=>a.toLowerCase())).size!==assets.length)throw Error('ASSETS_ENTERED_STOP');
  const controllerPin=r.sha256Code(await q('eth_getCode',[F.controller,block]));
  const native=r.quantity(await q('eth_getBalance',[F.owner,block]));
  const end=r.validateHeader(await q('eth_getBlockByNumber',[block,false]),block);if(end.hash!==h.hash||end.timestamp!==h.timestamp)throw Error('REORG_STOP');
  return {assets_entered:assets,controller_runtime_sha256:controllerPin,block_hash:h.hash,block_timestamp:Number(r.quantity(h.timestamp)),vtoken_balance_raw:a[1].toString(),stored_borrow_raw:a[2].toString(),current_accrued_debt_raw:current.toString(),exchange_rate_raw:a[3].toString(),native_balance_wei:native.toString()};
 }));
 if(stable(rows[0])!==stable(rows[1]))throw Error('QUORUM_STOP');
 const final=clock();if(!Number.isSafeInteger(final)||final<initial||final-rows[0].block_timestamp>120||final<rows[0].block_timestamp)throw Error('FRESHNESS_STOP');
 return {status:'OBSERVATIONAL_ONLY',authority:'NONE',execution_enabled:false,signing_ready:false,kind:request===r.rpc&&clock===systemClock?'OBSERVED':'SYNTHETIC',chain_id:97,wallet:F.owner,vbnb:F.vbnb,controller:F.controller,block_number:height.toString(),...rows[0],debt_status:rows[0].current_accrued_debt_raw==='0'?'NO_NATIVE_DEBT':'DEBT_OBSERVED_NO_ACTION',checked_at:new Date(final*1000).toISOString(),observed_at:final,assets_entered_observed:true,complete_native_scope:rows[0].assets_entered.every(a=>a.toLowerCase()===F.vbnb.toLowerCase()),complete_position:false,position_scope_status:'NATIVE_ONLY_OTHER_MARKET_DEBTS_NOT_ENUMERATED',oracle_freshness:'UNKNOWN',financial_source_review:false,scope:'Native vBNB only; accrued getter via eth_call simulation, no state committed'};
}
module.exports={observe,F,URLS};
if(require.main===module)(async()=>{if(process.argv.length===3&&process.argv[2]==='--read')return observe();if(process.argv.length!==2)throw Error('ARGUMENT_STOP');return{status:'NO_EXECUTION',execution_enabled:false}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.log('{"status":"NATIVE_OBSERVER_STOP","execution_enabled":false}');process.exitCode=1});
