const {test}=require('node:test');const assert=require('node:assert/strict');
const {packetDigest,validatePacket,assertPermit}=require('./operations/seller_submit_guard.cjs');
const {BINDINGS,canonicalJson}=require('./marketplace/negotiation.cjs');
const {encodeFunctionData,parseAbi,stringToHex}=require('./read_only/codec.cjs');
const ABI=parseAbi(['function submit(uint256,bytes32,bytes)']);
const SHA='1'.repeat(64),KECCAK='0x'+'2'.repeat(64),SEAL='3'.repeat(64);

function fixture(){
 const url=`https://positionguard.dyplux.com/deliverables/erc8183:97:${BINDINGS.commerce.toLowerCase()}:7/${SHA}.json`;
 const packet={schema_version:1,scope:'ERC8183_SUBMIT_ONLY',chain_id:97,agent_id:2583,provider:BINDINGS.provider,
  job_id:'7',funding_tx_hash:'0x'+'4'.repeat(64),quote_hash:'0x'+'5'.repeat(64),manifest_sha256:SHA,
  manifest_keccak256:KECCAK,deliverable_url:url,source_seal_sha256:SEAL,expires_at:2000000900,tx:{
   from:BINDINGS.provider,to:BINDINGS.commerce,value:'0x0',data:encodeFunctionData({abi:ABI,functionName:'submit',
    args:[7n,KECCAK,stringToHex(canonicalJson({deliverable_url:url}))]}),nonce:0,gas_limit:'100000',gas_price_wei:'1000000000'}};
 const grant={state:'AUTHORIZED',scope:'ERC8183_SUBMIT_ONLY',chain_id:97,agent_id:2583,provider:BINDINGS.provider,
  commerce:BINDINGS.commerce,packet_sha256:packetDigest(packet),source_seal_sha256:SEAL,expires_at:packet.expires_at,
  max_signatures:1,max_dispatches:1,max_gas_cost_wei:'1000000000000000',min_reserve_wei:'1000000000000000'};
 return {packet,grant};
}
function refresh(pair){pair.grant.packet_sha256=packetDigest(pair.packet);return pair;}

test('accepts one exact submit packet but confers no authority',()=>{
 const {packet,grant}=fixture();assert.deepEqual(validatePacket(packet,2000000000),{gas_cost_wei:'100000000000000'});
 assert.deepEqual(assertPermit(grant,packet,{now:2000000000,sealSha256:SEAL}),
  {status:'SUBMIT_SCHEMA_CHECK_ONLY',authority_verified:false});
 assert.match(packetDigest(packet),/^[0-9a-f]{64}$/);
});

test('packet schema, fixed bindings, decimals, hashes, expiry and fee are bounded',()=>{
 const changes=[p=>p.extra=true,p=>p.chain_id=56,p=>p.provider=p.provider.toLowerCase(),p=>p.job_id='07',
  p=>p.job_id=true,p=>p.manifest_sha256='A'.repeat(64),p=>p.expires_at=2000000901,p=>p.tx.nonce=true,
  p=>p.tx.gas_limit='050000',p=>p.tx.gas_limit='500001',p=>p.tx.gas_price_wei='9'.repeat(100),
  p=>p.tx.gas_price_wei='10000000001'];
 for(const change of changes){const pair=fixture();change(pair.packet);assert.throws(()=>validatePacket(pair.packet,2000000000));}
});

test('URL, function, arguments, option bytes and trailing calldata cannot drift',()=>{
 for(const mutate of [
  p=>p.deliverable_url+='x',
  p=>{p.tx.data=encodeFunctionData({abi:parseAbi(['function complete(uint256)']),functionName:'complete',args:[7n]});},
  p=>{p.tx.data=encodeFunctionData({abi:ABI,functionName:'submit',args:[8n,KECCAK,stringToHex(canonicalJson({deliverable_url:p.deliverable_url}))]});},
  p=>{p.tx.data=encodeFunctionData({abi:ABI,functionName:'submit',args:[7n,KECCAK,stringToHex('{"deliverable_url":"wrong"}')]});},
  p=>{p.tx.data+='00';}
 ]){const pair=fixture();mutate(pair.packet);assert.throws(()=>validatePacket(pair.packet,2000000000));}
});

test('grant must be complete and bind digest, seal, expiry, counts and economic limits',()=>{
 const mutations=[g=>delete g.commerce,g=>g.state='PROPOSED',g=>g.packet_sha256='0'.repeat(64),
  g=>g.source_seal_sha256='4'.repeat(64),g=>g.expires_at--,g=>g.max_signatures=true,g=>g.max_dispatches=0,
  g=>g.max_gas_cost_wei='99999999999999',g=>g.max_gas_cost_wei='1000000000000001',g=>g.min_reserve_wei='099'];
 for(const mutate of mutations){const {packet,grant}=fixture();mutate(grant);
  assert.throws(()=>assertPermit(grant,packet,{now:2000000000,sealSha256:SEAL}));}
 const pair=fixture();pair.packet.tx.nonce=1;refresh(pair);
 assert.throws(()=>assertPermit(pair.grant,pair.packet,{now:2000000000,sealSha256:'0'.repeat(64)}));
});
