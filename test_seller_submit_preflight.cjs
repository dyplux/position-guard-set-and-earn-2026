const {test}=require('node:test');const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {manifest,preflight}=require('./operations/seller_submit_preflight.cjs');
const {BINDINGS,canonicalJson}=require('./marketplace/negotiation.cjs');
const {sha}=require('./operations/seller_submit_io.cjs');
const now=2000000000,router='0xD7d36D66d2F1B608A0F943f722D27e3744f66F25',policy='0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA';
function fixture(){
 const python="import json,datetime;from server import fixture;from policy import assess;s=fixture('hold');s.update(source_kind='OBSERVED',rpc_url='MOCK_NOT_LIVE',block_timestamp=2000000000,checked_at='2033-05-18T03:33:20Z');print(json.dumps(assess(s,collector_attested=True)))";
 const r=cp.spawnSync('/usr/bin/python3',['-c',python],{cwd:__dirname,encoding:'utf8'});assert.equal(r.status,0);
 const receipt=JSON.parse(r.stdout);
 const value={version:1,chain_id:97,job_id:7,contracts:{commerce:BINDINGS.commerce,router,policy},
  response:{content:receipt,content_type:'application/json'},metadata:{agent_id:2583,
   job_evidence_kind:'REVIEWED_LOCAL_READER',receipt_sha256:sha(canonicalJson(receipt))}};
 const bytes=Buffer.from(canonicalJson(value));
 const input={job_id:'7',funding_tx_hash:'0x'+'b'.repeat(64),
  envelope:{negotiation_hash:'0x'+'c'.repeat(64),request:{task_description:'Assess Venus wallet 0x'+'0'.repeat(39)+'1'}},
  manifest_hex:'0x'+bytes.toString('hex')};
 const observed={chain_id:97,deployment:BINDINGS.commerce,attested:true,synthetic:false,source_kind:'OBSERVED',
  funding_verified:true,funding:{block_timestamp:now,block_number:1},block_timestamp:now,job:{id:'7',provider:BINDINGS.provider,evaluator:router,hook:router,
   statusName:'FUNDED',budget:'100',expiredAt:String(now+900)}};
 const calls=[];
 const request=async(url,method,params)=>{
  calls.push({url,method,params});
  return {eth_chainId:'0x61',eth_getTransactionCount:'0x3',eth_getBalance:'0x470de4df820000',
   eth_gasPrice:'0x3b9aca00',eth_call:'0x',eth_estimateGas:'0x186a0'}[method];
 };
 return {input,bytes,observed,calls,options:{sealSha256:'a'.repeat(64),request,
  verify:async()=>observed,fetchBytes:async()=>bytes,seal:async()=>{},clock:()=>now}};
}
test('latest exact submit simulation uses both RPCs and remains nonproduction under DI',async()=>{
 const f=fixture(),first=await preflight(f.input,f.options);
 assert.equal(first.production,false);assert.equal(first.packet.tx.nonce,3);
 assert.equal(first.packet.tx.gas_limit,'125000');assert.equal(first.packet.tx.gas_price_wei,'1250000000');
 const second=await preflight(f.input,{...f.options,approvedPacket:first.packet});
 assert.deepEqual(second.packet,first.packet);
 for(const call of f.calls.filter(c=>c.method==='eth_call')){
  assert.equal(call.params[1],'latest');assert.equal(call.params[0].value,'0x0');
  assert.equal(call.params[0].from,BINDINGS.provider);assert.equal(call.params[0].to,BINDINGS.commerce);
 }
 const last=f.calls.filter(c=>c.method==='eth_call').slice(-2);
 assert.equal(last[0].params[0].gas,'0x1e848');assert.equal(last[0].params[0].gasPrice,'0x4a817c80');
});
test('synthetic proof, changed public bytes and foreign receipt stop before simulation',async()=>{
 const f=fixture();f.observed.synthetic=true;await assert.rejects(()=>preflight(f.input,f.options));
 f.observed.synthetic=false;
 await assert.rejects(()=>preflight(f.input,{...f.options,fetchBytes:async()=>Buffer.from('changed')}));
 const value=JSON.parse(f.bytes);value.response.content.authority='WALLET';
 f.input.manifest_hex='0x'+Buffer.from(canonicalJson(value)).toString('hex');assert.throws(()=>manifest(f.input));
 assert.equal(f.calls.length,0);
});
test('pending nonce, insufficient reserve and nonvoid simulation stop',async()=>{
 for(const change of ['pending','balance','simulation']){
  const f=fixture(),original=f.options.request;
  f.options.request=async(url,method,params)=>{
   if(change==='pending'&&method==='eth_getTransactionCount'&&params[1]==='pending')return '0x4';
   if(change==='balance'&&method==='eth_getBalance')return '0x1';
   if(change==='simulation'&&method==='eth_call')return '0x'+'0'.repeat(64);
   return original(url,method,params);
  };
  await assert.rejects(()=>preflight(f.input,f.options));
 }
});
test('a receipt collected before the funded hire cannot fulfil a new job',async()=>{
 const f=fixture();f.observed.funding.block_timestamp=now+10;
 f.observed.block_timestamp=now+10;f.observed.funding.block_number=2;f.options.clock=()=>now+10;
 await assert.rejects(()=>preflight(f.input,f.options),/SNAPSHOT_BEFORE_HIRE_OR_FUTURE/);
 assert.equal(f.calls.length,0);
});
