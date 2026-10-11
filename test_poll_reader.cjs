const {test}=require('node:test');const assert=require('node:assert/strict');
const {scan}=require('./marketplace/poll_reader.cjs');
const {BINDINGS}=require('./marketplace/negotiation.cjs');
const {FUNDED_ABI}=require('./marketplace/funding.cjs');
const {encodeEventTopics,encodeAbiParameters}=require('./read_only/codec.cjs');
const hash='0x'+'a'.repeat(64),tx='0x'+'b'.repeat(64);
function fixture(){
 const log={address:BINDINGS.commerce,transactionHash:tx,blockHash:hash,blockNumber:'0x64',logIndex:'0x1',removed:false,
  topics:encodeEventTopics({abi:FUNDED_ABI,eventName:'JobFunded',args:{jobId:7n,client:'0x'+'1'.repeat(40),provider:BINDINGS.provider}}),
  data:encodeAbiParameters([{type:'uint256'}],[100n])};
 const f={log,head:'0x80'};
 f.request=async(url,method,params)=>{
  if(method==='eth_chainId')return '0x61';if(method==='eth_blockNumber')return f.head;
  if(method==='eth_getBlockByNumber')return {number:params[0],hash,timestamp:'0x77359400'};
  if(method==='eth_getLogs')return [f.log];throw Error('UNEXPECTED_RPC');
 };
 return f;
}
test('bounded event range binds provider and remains synthetic under injected transport',async()=>{
 const f=fixture(),result=await scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}});
 assert.equal(result.to_block,116);assert.equal(result.attested,false);assert.equal(result.synthetic,true);
 assert.deepEqual(result.events,[{job_id:7,tx_hash:tx,log_index:1,block_number:100,block_hash:hash}]);
});
test('anchor reorg and forged provenance stop before processing',async()=>{
 const f=fixture();await assert.rejects(()=>scan({from_block:100,previous_hash:'0x'+'c'.repeat(64)},{request:f.request,seal:async()=>{}}),/REORG/);
 f.log.address='0x'+'1'.repeat(40);await assert.rejects(()=>scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}}));
});
test('confirmation wait produces no events and no cursor advance',async()=>{
 const f=fixture();f.head='0x64';
 const result=await scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}});
 assert.equal(result.status,'WAIT_CONFIRMATIONS');assert.deepEqual(result.events,[]);assert.equal(result.to_block,undefined);
});
test('equivalent hexadecimal log indexes cannot duplicate provenance',async()=>{
 const f=fixture(),original=f.request;
 f.request=async(url,method,params)=>method==='eth_getLogs'?
  [{...f.log,logIndex:'0xA'},{...f.log,logIndex:'0xa'}]:original(url,method,params);
 await assert.rejects(()=>scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}}),/DUPLICATE/);
});
test('RPC-specific block size does not create a false consensus disagreement',async()=>{
 const f=fixture(),original=f.request;
 f.request=async(url,method,params)=>{
  const value=await original(url,method,params);
  return method==='eth_getBlockByNumber'?{...value,size:url.includes('publicnode')?'0x1':'0x2'}:value;
 };
 assert.equal((await scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}})).status,'SCANNED');
});
test('disabled getLogs falls back to successful canonical block receipts without cursor widening',async()=>{
 const f=fixture(),original=f.request;
 f.request=async(url,method,params)=>{
  if(method==='eth_getLogs')throw Error('LOGS_DISABLED');
  if(method==='eth_getBlockReceipts')return params[0]==='0x64'?[{status:'0x1',blockNumber:'0x64',blockHash:hash,transactionHash:tx,logs:[f.log]}]:[];
  return original(url,method,params);
 };
 const result=await scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}});
 assert.equal(result.to_block,116);assert.equal(result.events.length,1);assert.equal(result.attested,false);
});
test('receipt fallback bounds the whole page across blocks',async()=>{
 const f=fixture(),original=f.request;
 f.request=async(url,method,params)=>{
  if(method==='eth_getLogs')throw Error('LOGS_DISABLED');
  if(method==='eth_getBlockReceipts')return Array.from({length:300},()=>({logs:[]}));
  return original(url,method,params);
 };
 await assert.rejects(()=>scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}}),/BUDGET/);
});
test('receipt reads have bounded concurrency and pages never exceed 128 blocks',async()=>{
 const f=fixture(),original=f.request;f.head='0x200';let active=0,peak=0,reads=0;
 f.request=async(url,method,params)=>{
  if(method==='eth_getLogs')throw Error('LOGS_DISABLED');
  if(method==='eth_getBlockReceipts'){
   active++;peak=Math.max(peak,active);reads++;
   await new Promise(resolve=>setTimeout(resolve,1));active--;return [];
  }
  return original(url,method,params);
 };
 const result=await scan({from_block:100,previous_hash:hash},{request:f.request,seal:async()=>{}});
 assert.equal(result.to_block,227);assert.equal(reads,256);assert.equal(peak,4);
});
