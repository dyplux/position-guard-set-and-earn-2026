/* Key-free latest preflight for one exact chain97 submit. */
const cp=require('node:child_process');
const {ROOT,sha}=require('./seller_submit_io.cjs');
const {rpc,quantity}=require('../read_only/rpc.cjs');
const {verifyFundedJob,assertSeal}=require('../marketplace/funding.cjs');
const {BINDINGS,canonicalJson}=require('../marketplace/negotiation.cjs');
const {prepareSubmission}=require('../marketplace/submission.cjs');
const URLS=Object.freeze(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);
const MAX_FEE=1000000000000000n,MIN_RESERVE=1000000000000000n;
function hex(n){return '0x'+n.toString(16);}
function manifest(input){
 if(!input||!/^0x(?:[0-9a-f]{2}){1,262144}$/.test(input.manifest_hex))throw Error('MANIFEST_HEX_STOP');
 const bytes=Buffer.from(input.manifest_hex.slice(2),'hex'),value=JSON.parse(bytes.toString('utf8'));
 const receipt=value.response?.content,snapshot=receipt?.normalized_snapshot;
 const wallets=new Set(input.envelope?.request?.task_description?.match(/0x[0-9a-fA-F]{40}\b/g)||[]);
 if(wallets.size!==1||!/venus/i.test(input.envelope.request.task_description)||value.metadata?.agent_id!==2583
   ||value.metadata?.job_evidence_kind!=='REVIEWED_LOCAL_READER'||value.response?.content_type!=='application/json'
   ||receipt?.evidence_kind!=='OBSERVED'||snapshot?.source_kind!=='OBSERVED'||snapshot.chain_id!==97
   ||typeof snapshot.wallet_address!=='string'||snapshot.wallet_address.toLowerCase()!==[...wallets][0].toLowerCase()
   ||receipt.authority!=='NONE'||receipt.execution_enabled!==false||receipt.policy_version!=='0.2.0'
   ||value.metadata.receipt_sha256!==sha(canonicalJson(receipt)))throw Error('OBSERVED_SERVICE_RECEIPT_REQUIRED');
 if(receipt.decision==='NEED_EVIDENCE'&&!input.envelope.response?.terms?.quality_standards?.includes('NEED_EVIDENCE accepted'))throw Error('INCOMPLETE_OUTCOME_NOT_CONTRACTED');
 const python="import json,sys;sys.path.insert(0,sys.argv[1]);from policy import assess,verify_receipt;r=json.load(sys.stdin);assert verify_receipt(r) and assess(r['normalized_snapshot'],collector_attested=True)==r";
 const checked=cp.spawnSync('/usr/bin/python3',['-I','-c',python,ROOT],{
  input:JSON.stringify(receipt),encoding:'utf8',timeout:5000,maxBuffer:8192});
 if(checked.error||checked.status!==0)throw Error('POLICY_RECEIPT_BINDING_STOP');
 return bytes;
}
async function publicBytes(url){
 const response=await fetch(url,{redirect:'error',headers:{'accept-encoding':'identity'},signal:AbortSignal.timeout(10000)});
 if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('PUBLIC_DELIVERY_REQUIRED');
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>262144)throw Error('PUBLIC_DELIVERY_LIMIT');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
async function latestLimits(tx,{request=rpc,seal=assertSeal}={}){
 const states=[];
 for(const url of URLS){
  if(quantity(await request(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
  await seal(request,url,'latest');
  const [confirmed,pending,balance,price]=await Promise.all([
   request(url,'eth_getTransactionCount',[BINDINGS.provider,'latest']),
   request(url,'eth_getTransactionCount',[BINDINGS.provider,'pending']),
   request(url,'eth_getBalance',[BINDINGS.provider,'latest']),request(url,'eth_gasPrice')]);
  if(confirmed!==pending)throw Error('PENDING_NONCE_STOP');
  const nonce=quantity(confirmed),gasPrice=quantity(price);
  if(nonce>BigInt(Number.MAX_SAFE_INTEGER)||gasPrice<=0n)throw Error('NONCE_PRICE_STOP');
  const call={...tx};
  if(await request(url,'eth_call',[call,'latest'])!=='0x')throw Error('SUBMIT_SIMULATION_STOP');
  const estimate=quantity(await request(url,'eth_estimateGas',[call,'latest']));
  if(estimate===0n)throw Error('GAS_ESTIMATE_STOP');
  states.push({nonce,balance:quantity(balance),gasPrice,estimate});
 }
 if(states[0].nonce!==states[1].nonce)throw Error('RPC_NONCE_DISAGREEMENT');
 return {nonce:Number(states[0].nonce),balance:states.reduce((a,s)=>a<s.balance?a:s.balance,states[0].balance),
  gasPrice:states.reduce((a,s)=>a>s.gasPrice?a:s.gasPrice,0n),estimate:states.reduce((a,s)=>a>s.estimate?a:s.estimate,0n)};
}
async function preflight(input,{approvedPacket=null,sealSha256,request=rpc,verify=verifyFundedJob,
 fetchBytes=publicBytes,seal=assertSeal,clock=()=>Math.floor(Date.now()/1000)}={}){
 if(!/^[1-9][0-9]{0,15}$/.test(input?.job_id)||BigInt(input.job_id)>BigInt(Number.MAX_SAFE_INTEGER)
   ||!/^0x[0-9a-f]{64}$/.test(input.funding_tx_hash))throw Error('SUBMIT_INPUT_STOP');
 const bytes=manifest(input);
 const observed=await verify({jobId:BigInt(input.job_id),envelope:input.envelope,
  fundingTxHash:input.funding_tx_hash,urls:URLS});
 if(observed.attested!==true||observed.synthetic===true||observed.source_kind!=='OBSERVED'
   ||observed.funding_verified!==true||Math.abs(clock()-observed.block_timestamp)>60)throw Error('PUBLIC_FUNDED_PROOF_REQUIRED');
 const submission=prepareSubmission({job:observed,manifestBytes:bytes,now:clock()});
 if(!(await fetchBytes(submission.deliverable_url)).equals(bytes))throw Error('PUBLIC_DELIVERY_BYTES_STOP');
 const tx={...submission.tx};
 if(approvedPacket){tx.gas=hex(BigInt(approvedPacket.tx.gas_limit));tx.gasPrice=hex(BigInt(approvedPacket.tx.gas_price_wei));tx.nonce=hex(BigInt(approvedPacket.tx.nonce));}
 const limits=await latestLimits(tx,{request,seal});
 const gas=approvedPacket?BigInt(approvedPacket.tx.gas_limit):(limits.estimate*125n+99n)/100n;
 const price=approvedPacket?BigInt(approvedPacket.tx.gas_price_wei):(limits.gasPrice*125n+99n)/100n;
 if(limits.estimate>gas||gas>500000n||price<limits.gasPrice||gas*price>MAX_FEE
   ||limits.balance<gas*price+MIN_RESERVE)throw Error('GAS_OR_RESERVE_STOP');
 const expires=approvedPacket?approvedPacket.expires_at:Math.min(clock()+300,Number(observed.job.expiredAt)-30);
 if(expires<=clock()||expires>Number(observed.job.expiredAt)-30)throw Error('SUBMIT_DEADLINE_STOP');
 const packet={schema_version:1,scope:'ERC8183_SUBMIT_ONLY',chain_id:97,agent_id:2583,provider:BINDINGS.provider,
  job_id:input.job_id,funding_tx_hash:input.funding_tx_hash,quote_hash:input.envelope.negotiation_hash,
  manifest_sha256:submission.manifest_sha256,manifest_keccak256:submission.manifest_keccak256,
  deliverable_url:submission.deliverable_url,source_seal_sha256:sealSha256,expires_at:expires,
  tx:{...submission.tx,nonce:limits.nonce,gas_limit:gas.toString(),gas_price_wei:price.toString()}};
 if(approvedPacket&&canonicalJson(packet)!==canonicalJson(approvedPacket))throw Error('APPROVED_PACKET_DRIFT');
 return {packet,balance:limits.balance,production:request===rpc&&verify===verifyFundedJob&&fetchBytes===publicBytes&&seal===assertSeal};
}
module.exports={URLS,MAX_FEE,MIN_RESERVE,manifest,latestLimits,preflight};
