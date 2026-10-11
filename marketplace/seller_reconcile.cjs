/* Read-only submission/rail completion proof. Never settles, claims or resends. */
const {parseAbi,encodeFunctionData,decodeFunctionResult,decodeEventLog}=require('../read_only/codec.cjs');
const {rpc,quantity,validateHeader}=require('../read_only/rpc.cjs');
const {assertSeal,SEAL}=require('./funding.cjs');
const {BINDINGS,canonicalJson}=require('./negotiation.cjs');
const {JOB_SIGNATURE}=require('./erc8183.cjs');
const {validatePacket}=require('../operations/seller_submit_guard.cjs');
const URLS=['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
const ABI=parseAbi(['event JobSubmitted(uint256 indexed jobId,address indexed provider,bytes32 deliverable)']);
const JOB_ABI=parseAbi([JOB_SIGNATURE]);
const hash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
function stable(value){return canonicalJson(JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)));}
function receiptProof(receipt,tx,header,packet,txHash){
 validateHeader(header,receipt.blockNumber);
 if(!hash(txHash)||receipt.status!=='0x1'||!same(receipt.transactionHash,txHash)||!same(tx.hash,txHash)
   ||!same(receipt.blockHash,header.hash)||!same(tx.blockHash,header.hash)||tx.blockNumber!==receipt.blockNumber
   ||!same(tx.from,BINDINGS.provider)||!same(tx.to,BINDINGS.commerce)||quantity(tx.chainId)!==97n
   ||quantity(tx.value)!==0n||quantity(tx.nonce)!==BigInt(packet.tx.nonce)||tx.input!==packet.tx.data
   ||quantity(tx.gas)!==BigInt(packet.tx.gas_limit)||quantity(tx.gasPrice)!==BigInt(packet.tx.gas_price_wei)
   ||!Array.isArray(receipt.logs)||receipt.logs.length>2048)throw Error('SUBMIT_RECEIPT_BINDING_STOP');
 const events=[];
 for(const log of receipt.logs){
  if(!same(log.address,BINDINGS.commerce))continue;
  let decoded;try{decoded=decodeEventLog({abi:ABI,data:log.data,topics:log.topics,strict:true});}catch{continue;}
  if(decoded.eventName==='JobSubmitted'&&decoded.args.jobId===BigInt(packet.job_id))events.push({log,args:decoded.args});
 }
 if(events.length!==1)throw Error('UNIQUE_SUBMITTED_EVENT_REQUIRED');
 const {log,args}=events[0];
 if(log.removed===true||!same(log.blockHash,header.hash)||!same(log.transactionHash,txHash)
   ||log.blockNumber!==receipt.blockNumber||!same(args.provider,BINDINGS.provider)
   ||args.deliverable!==packet.manifest_keccak256)throw Error('SUBMITTED_EVENT_STOP');
 const gas=quantity(receipt.gasUsed),price=quantity(receipt.effectiveGasPrice);
 if(gas>BigInt(packet.tx.gas_limit)||price!==BigInt(packet.tx.gas_price_wei))throw Error('RECEIPT_GAS_STOP');
 return {tx_hash:txHash.toLowerCase(),block_number:Number(quantity(receipt.blockNumber)),block_hash:header.hash,
  block_timestamp:Number(quantity(header.timestamp)),gas_cost_wei:(gas*price).toString()};
}
async function reconcile(packet,txHash,{request=rpc,seal=assertSeal,clock=()=>Math.floor(Date.now()/1000)}={}){
 // Expired grants remain readable; this doesn't authorize any new operation.
 validatePacket(packet,Math.min(clock(),packet.expires_at-1));if(!hash(txHash))throw Error('TX_HASH_REQUIRED');
 const heights=await Promise.all(URLS.map(url=>request(url,'eth_blockNumber').then(quantity)));
 const height=heights[0]<heights[1]?heights[0]:heights[1],block='0x'+height.toString(16),results=[];
 for(const url of URLS){
  if(quantity(await request(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
  const [receipt,tx]=await Promise.all([request(url,'eth_getTransactionReceipt',[txHash]),request(url,'eth_getTransactionByHash',[txHash])]);
  if(!receipt||!tx) return {status:'RECONCILIATION_PENDING',tx_hash:txHash,completed_onchain:false,execution_enabled:false};
  if(height<quantity(receipt.blockNumber)+2n)return {status:'WAIT_CONFIRMATIONS',tx_hash:txHash,completed_onchain:false,execution_enabled:false};
  const header=await request(url,'eth_getBlockByNumber',[receipt.blockNumber,false]);
  await seal(request,url,receipt.blockNumber);
  const proof=receiptProof(receipt,tx,header,packet,txHash);
  const current=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  if(Math.abs(clock()-Number(quantity(current.timestamp)))>60)throw Error('FRESH_HEAD_STOP');
  await seal(request,url,block);
  const data=encodeFunctionData({abi:JOB_ABI,functionName:'getJob',args:[BigInt(packet.job_id)]});
  const job=decodeFunctionResult({abi:JOB_ABI,functionName:'getJob',data:await request(url,'eth_call',[{to:BINDINGS.commerce,data},block])});
  if(job.id!==BigInt(packet.job_id)||!same(job.provider,BINDINGS.provider)||job.deliverable!==packet.manifest_keccak256
    ||![2,3,4,5].includes(job.status)||job.submittedAt!==quantity(header.timestamp)
    ||!same(job.evaluator,SEAL.router.address)||!same(job.hook,SEAL.router.address))throw Error('SUBMISSION_EFFECT_STOP');
  const description=JSON.parse(job.description);
  if(description.protocol!=='pokter-job'||description.identity?.chainId!==97||description.identity?.tokenId!=='2583'
    ||description.quote?.negotiationHash?.toLowerCase()!==packet.quote_hash)throw Error('RECONCILE_QUOTE_JOB_STOP');
  for(const tag of [receipt.blockNumber,block]){
   const checked=validateHeader(await request(url,'eth_getBlockByNumber',[tag,false]),tag);
   if(checked.hash!==(tag===block?current:header).hash)throw Error('RECONCILIATION_REORG_STOP');
  }
  results.push({proof,job_status:job.status,current_block_hash:current.hash});
 }
 if(stable(results[0])!==stable(results[1]))throw Error('RPC_RECONCILIATION_DISAGREEMENT');
 const production=request===rpc&&seal===assertSeal,observed=results[0];
 return {status:production?(observed.job_status===3?'COMPLETED':'SUBMISSION_RECONCILED'):'SYNTHETIC_RECONCILIATION',
  ...observed.proof,job_id:packet.job_id,job_status:observed.job_status,attested:production,synthetic:!production,
  completed_onchain:production&&observed.job_status===3,execution_enabled:false};
}
module.exports={receiptProof,reconcile};
