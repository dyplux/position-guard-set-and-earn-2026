const {test}=require('node:test');const assert=require('node:assert/strict');
const {oneShot}=require('./operations/seller_submit_execution.cjs');
const {BINDINGS,canonicalJson}=require('./marketplace/negotiation.cjs');
const {encodeFunctionData,parseAbi,toHex,keccak256}=require('./read_only/codec.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {durable,reserveJobNonce}=require('./operations/seller_submit_io.cjs');
const now=2000000000;
function fixture(){
 const sha='a'.repeat(64),hash='0x'+'b'.repeat(64);
 const url=`https://positionguard.dyplux.com/deliverables/erc8183:97:${BINDINGS.commerce.toLowerCase()}:7/${sha}.json`;
 const packet={schema_version:1,scope:'ERC8183_SUBMIT_ONLY',chain_id:97,agent_id:2583,provider:BINDINGS.provider,
  job_id:'7',funding_tx_hash:hash,quote_hash:hash,manifest_sha256:sha,manifest_keccak256:hash,
  deliverable_url:url,source_seal_sha256:sha,expires_at:now+300,
  tx:{from:BINDINGS.provider,to:BINDINGS.commerce,value:'0x0',nonce:3,gas_limit:'125000',gas_price_wei:'1000000000',
   data:encodeFunctionData({abi:parseAbi(['function submit(uint256,bytes32,bytes)']),functionName:'submit',
    args:[7n,hash,toHex(canonicalJson({deliverable_url:url}))]})}};
 const events=[],journals=[];let signs=0,sends=0,reserved=false;
 const opts={packet,clock:()=>now,reserve:()=>{if(reserved)throw Error('LOCK_EXISTS');reserved=true;events.push('lock');},
  journal:s=>{journals.push({...s});events.push(s.status);},beforeSign:async()=>events.push('preflight'),
  sign:async()=>{signs++;events.push('sign');return '0x01';},verifySigned:async()=>events.push('verify'),
  beforeSend:async()=>events.push('latest'),broadcast:async()=>{sends++;events.push('send');return keccak256('0x01');}};
 return {opts,events,journals,counts:()=>({signs,sends})};
}
test('durable reservations and phase journals precede signature and dispatch',async()=>{
 const f=fixture(),result=await oneShot(f.opts);
 assert.equal(result.status,'BROADCAST');assert.equal(result.completed_onchain,false);
 assert.ok(f.events.indexOf('lock')<f.events.indexOf('sign'));
 assert.ok(f.events.indexOf('SIGNING_BEGUN')<f.events.indexOf('sign'));
 assert.ok(f.events.indexOf('DISPATCH_BEGUN')<f.events.indexOf('send'));
 assert.deepEqual(f.counts(),{signs:1,sends:1});
 await assert.rejects(()=>oneShot(f.opts),/LOCK_EXISTS/);
 assert.deepEqual(f.counts(),{signs:1,sends:1});
});
test('ambiguous dispatch retains exact hash and never retries',async()=>{
 const f=fixture();f.opts.broadcast=async()=>{throw Error('NETWORK_AMBIGUOUS');};
 const result=await oneShot(f.opts);
 assert.equal(result.status,'AMBIGUOUS_RECONCILE_ONLY');assert.equal(result.dispatch_count,1);
 assert.equal(result.tx_hash,keccak256('0x01'));
 await assert.rejects(()=>oneShot(f.opts));assert.equal(f.counts().signs,1);
});
test('pre-sign failure produces zero signatures; unknown signing failure stays consumed',async()=>{
 const first=fixture();first.opts.beforeSign=async()=>{throw Error('FRESH_STOP');};
 assert.equal((await oneShot(first.opts)).status,'STOP_BEFORE_SIGNING');
 assert.deepEqual(first.counts(),{signs:0,sends:0});
 const second=fixture();second.opts.sign=async()=>{throw Error('SIGN_RESULT_LOST');};
 const result=await oneShot(second.opts);
 assert.equal(result.status,'SIGNATURE_RECONCILE_ONLY');assert.equal(result.signature_may_exist,true);
 await assert.rejects(()=>oneShot(second.opts));assert.equal(second.counts().sends,0);
});
test('expired grant after signing never dispatches',async()=>{
 const f=fixture();let stamp=now;
 f.opts.clock=()=>stamp;f.opts.beforeSend=async()=>{stamp=now+301;};
 const result=await oneShot(f.opts);
 assert.equal(result.status,'SIGNATURE_RECONCILE_ONLY');assert.equal(result.dispatch_count,0);
});
test('failure between job and nonce reservation records a consumed zero-signature stop',async()=>{
 const f=fixture();
 f.opts.reserve=()=>{const error=Error('NONCE_LOCK_EXISTS');error.reservation_owned=true;throw error;};
 const result=await oneShot(f.opts);
 assert.equal(result.status,'STOP_BEFORE_SIGNING');assert.equal(result.reservation_incomplete,true);
 assert.equal(f.journals.length,1);assert.equal(f.journals[0].signature_count,0);
 assert.deepEqual(f.counts(),{signs:0,sends:0});
});
test('real reservation callback journals nonce conflict without any signing',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seller-reserve-'));fs.chmodSync(root,0o700);
 try{
  durable(path.join(root,'nonce-3.lock'),{prior_job:'6'});
  const f=fixture();f.opts.reserve=()=>reserveJobNonce(root,{job_id:'7',nonce:3,packet_sha256:'a'.repeat(64)});
  f.opts.journal=state=>durable(path.join(root,state.status+'.json'),state);
  const result=await oneShot(f.opts);
  assert.equal(result.status,'STOP_BEFORE_SIGNING');assert.equal(result.reservation_incomplete,true);
  assert.equal(fs.existsSync(path.join(root,'job-7.lock')),true);
  const stored=JSON.parse(fs.readFileSync(path.join(root,'STOP_BEFORE_SIGNING.json')));
  assert.equal(stored.signature_count,0);assert.equal(stored.dispatch_count,0);
  assert.deepEqual(f.counts(),{signs:0,sends:0});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'nonce-3.lock'))),{prior_job:'6'});
 }finally{fs.rmSync(root,{recursive:true});}
});
