const {test}=require('node:test');const assert=require('node:assert/strict');
const {receiptProof,reconcile}=require('./marketplace/seller_reconcile.cjs');
const {BINDINGS,canonicalJson}=require('./marketplace/negotiation.cjs');
const {JOB_SIGNATURE}=require('./marketplace/erc8183.cjs');
const {parseAbi,encodeFunctionData,encodeFunctionResult,encodeEventTopics,encodeAbiParameters,toHex}=require('./read_only/codec.cjs');
const now=2000000000,hash='0x'+'a'.repeat(64),commit='0x'+'b'.repeat(64),blockHash='0x'+'c'.repeat(64);
function fixture(status=2){
 const sha='d'.repeat(64),url=`https://positionguard.dyplux.com/deliverables/erc8183:97:${BINDINGS.commerce.toLowerCase()}:7/${sha}.json`;
 const packet={schema_version:1,scope:'ERC8183_SUBMIT_ONLY',chain_id:97,agent_id:2583,provider:BINDINGS.provider,
  job_id:'7',funding_tx_hash:hash,quote_hash:hash,manifest_sha256:sha,manifest_keccak256:commit,
  deliverable_url:url,source_seal_sha256:sha,expires_at:now+300,
  tx:{from:BINDINGS.provider,to:BINDINGS.commerce,value:'0x0',nonce:3,gas_limit:'125000',gas_price_wei:'1000000000',
   data:encodeFunctionData({abi:parseAbi(['function submit(uint256,bytes32,bytes)']),functionName:'submit',
    args:[7n,commit,toHex(canonicalJson({deliverable_url:url}))]})}};
 const abi=parseAbi(['event JobSubmitted(uint256 indexed jobId,address indexed provider,bytes32 deliverable)']);
 const log={address:BINDINGS.commerce,blockNumber:'0x10',blockHash,transactionHash:hash,logIndex:'0x1',removed:false,
  topics:encodeEventTopics({abi,eventName:'JobSubmitted',args:{jobId:7n,provider:BINDINGS.provider}}),
  data:encodeAbiParameters([{type:'bytes32'}],[commit])};
 const receipt={status:'0x1',transactionHash:hash,blockNumber:'0x10',blockHash,
  gasUsed:'0x186a0',effectiveGasPrice:'0x3b9aca00',logs:[log]};
 const tx={hash,blockHash,blockNumber:'0x10',from:BINDINGS.provider,to:BINDINGS.commerce,chainId:'0x61',value:'0x0',
  nonce:'0x3',gas:'0x1e848',gasPrice:'0x3b9aca00',input:packet.tx.data};
 const header={number:'0x10',hash:blockHash,timestamp:'0x77359400'};
 const router='0xD7d36D66d2F1B608A0F943f722D27e3744f66F25';
 const job={id:7n,client:'0x'+'1'.repeat(40),provider:BINDINGS.provider,evaluator:router,
  description:JSON.stringify({protocol:'pokter-job',identity:{chainId:97,tokenId:'2583'},quote:{negotiationHash:hash}}),
  budget:100n,expiredAt:BigInt(now+900),status,hook:router,submittedAt:BigInt(now),deliverable:commit};
 const request=async(url,method,params)=>{
  if(method==='eth_blockNumber')return '0x20';if(method==='eth_chainId')return '0x61';
  if(method==='eth_getTransactionReceipt')return receipt;if(method==='eth_getTransactionByHash')return tx;
  if(method==='eth_getBlockByNumber')return params[0]==='0x10'?header:{number:'0x20',hash:'0x'+'e'.repeat(64),timestamp:header.timestamp};
  if(method==='eth_call')return encodeFunctionResult({abi:parseAbi([JOB_SIGNATURE]),functionName:'getJob',result:job});
  throw Error('UNEXPECTED_RPC');
 };
 return {packet,receipt,tx,header,job,options:{request,seal:async()=>{},clock:()=>now}};
}
test('receipt, unique provider event and exact commitment are required',()=>{
 const f=fixture();assert.equal(receiptProof(f.receipt,f.tx,f.header,f.packet,hash).gas_cost_wei,'100000000000000');
 for(const alter of [()=>f.receipt.status='0x0',()=>f.tx.value='0x1',()=>f.tx.chainId='0x38',
  ()=>f.receipt.logs.push({...f.receipt.logs[0]}),()=>f.receipt.logs[0].removed=true]){
  const current=fixture();Object.assign(f,current);alter();assert.throws(()=>receiptProof(f.receipt,f.tx,f.header,f.packet,hash));
 }
});
test('submission and completion are separate; synthetic RPC never asserts real completion',async()=>{
 for(const status of [2,3]){
  const f=fixture(status),result=await reconcile(f.packet,hash,f.options);
  assert.equal(result.job_status,status);assert.equal(result.synthetic,true);
  assert.equal(result.attested,false);assert.equal(result.completed_onchain,false);
  assert.equal(result.status,'SYNTHETIC_RECONCILIATION');
 }
});
test('missing receipt waits; divergent RPC or wrong post-state stops',async()=>{
 const f=fixture();
 const missing=await reconcile(f.packet,hash,{...f.options,request:async(url,method,params)=>method==='eth_getTransactionReceipt'?null:f.options.request(url,method,params)});
 assert.equal(missing.status,'RECONCILIATION_PENDING');assert.equal(missing.completed_onchain,false);
 f.job.deliverable='0x'+'0'.repeat(64);await assert.rejects(()=>reconcile(f.packet,hash,f.options));
 const other=fixture();const original=other.options.request;
 other.options.request=async(url,method,params)=>{
  if(method==='eth_call'&&url.includes('publicnode'))return encodeFunctionResult({abi:parseAbi([JOB_SIGNATURE]),functionName:'getJob',result:{...other.job,status:3}});
  return original(url,method,params);
 };
 await assert.rejects(()=>reconcile(other.packet,hash,other.options),/DISAGREEMENT/);
});
