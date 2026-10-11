/* Read-only funded-receipt binding. Signing/submission are separate operations. */
const {getAddress,parseAbi,decodeEventLog,encodeEventTopics,encodeFunctionData,decodeFunctionResult}=require('../read_only/codec.cjs');
const {rpc,quantity,validateHeader,sha256Code}=require('../read_only/rpc.cjs');
const {BINDINGS,prepareQuote,verifyQuote,canonicalJson}=require('./negotiation.cjs');
const {JOB_SIGNATURE}=require('./erc8183.cjs');
const FUNDED_ABI=parseAbi(['event JobFunded(uint256 indexed jobId,address indexed client,address indexed provider,uint256 amount)']);
const TRANSFER_ABI=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const FUNDED_TOPIC=encodeEventTopics({abi:FUNDED_ABI,eventName:'JobFunded'})[0];
const TRANSFER_TOPIC=encodeEventTopics({abi:TRANSFER_ABI,eventName:'Transfer'})[0];
const HASH=/^0x[0-9a-fA-F]{64}$/;
const SEAL=Object.freeze({
 commerce:{address:BINDINGS.commerce,runtime:'a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d',implementation:'0x55c3826b39a0f671b2c3e5d0f1372cad0b911421',implementationRuntime:'4ad4ceb54eda77f76e67d7e0ce12cb7bab6b6d2e8d64ee231976d904c6980d4f'},
 router:{address:'0xD7d36D66d2F1B608A0F943f722D27e3744f66F25',runtime:'a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d',implementation:'0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e',implementationRuntime:'41ff045ec43932e4f28d25146edaf0a5c1d2425f3dab826c88afa52ec8ab1fa1'},
 policy:{address:'0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA',runtime:'4a17125e2600679a15b88acf8cd481f442d8056fd38da709a4a774e621258ed5'},
 token:{address:BINDINGS.paymentToken,runtime:'1076ca0b58e992bba671ddbde6a9d96685c712113eee50caa891c458fc2b48a9',implementation:'0x6b5c44cbd4bbddf11723557ba1b77ec5e33225cc',implementationRuntime:'d6c77e5ad76d639516b22b00244bd0c94e2631f1940fc550b77e059f24fe75a3'}
 ,registry:{address:'0x8004A818BFB912233c491871b3d84c89A494BD9e',runtime:'e3b1c1b4c04b34f90557a867aaef6bf2d57c5674e7a9f24994ae498ffd0f6f85',implementation:'0x7274e874ca62410a93bd8bf61c69d8045e399c02',implementationRuntime:'201b7634af2de088c58868052856922ea8534c47e2837f19529460e2fafb4ff1'}
});
const SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const PUBLIC_RPCS=new Set(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);
function sameAddress(a,b){return getAddress(a)===getAddress(b);}
function stable(value){return canonicalJson(JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)));}
function validateReceipt(receipt,header,job){
 const block='0x'+BigInt(receipt.blockNumber).toString(16);validateHeader(header,block);
 if(receipt.status!=='0x1'||!HASH.test(receipt.transactionHash)||!HASH.test(receipt.blockHash)
  ||receipt.blockHash.toLowerCase()!==header.hash.toLowerCase()||!Array.isArray(receipt.logs)||receipt.logs.length>2048)throw Error('FUNDED_RECEIPT_STOP');
 const candidates=receipt.logs.filter(log=>sameAddress(log.address,BINDINGS.commerce)&&log.topics?.[0]?.toLowerCase()===FUNDED_TOPIC.toLowerCase());
 const matches=[];
 for(const log of candidates){
  const decoded=decodeEventLog({abi:FUNDED_ABI,data:log.data,topics:log.topics,strict:true});
  if(decoded.eventName==='JobFunded'&&decoded.args.jobId===job.id)matches.push({log,args:decoded.args});
 }
 if(matches.length!==1)throw Error('UNIQUE_FUNDED_EVENT_REQUIRED');
 const {log,args}=matches[0];
 if(log.removed===true||log.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()
  ||log.transactionHash?.toLowerCase()!==receipt.transactionHash.toLowerCase()
  ||quantity(log.blockNumber)!==quantity(receipt.blockNumber)
  ||!sameAddress(args.client,job.client)||!sameAddress(args.provider,job.provider)||args.amount!==job.budget)throw Error('FUNDED_EVENT_BINDING_STOP');
 const index=quantity(log.logIndex);
 if(index>BigInt(Number.MAX_SAFE_INTEGER))throw Error('SAFE_LOG_INDEX_REQUIRED');
 const transfers=receipt.logs.filter(x=>sameAddress(x.address,BINDINGS.paymentToken)&&x.topics?.[0]?.toLowerCase()===TRANSFER_TOPIC.toLowerCase());
 const paid=transfers.filter(x=>{
  const d=decodeEventLog({abi:TRANSFER_ABI,data:x.data,topics:x.topics,strict:true});
  return x.removed!==true&&x.blockHash?.toLowerCase()===receipt.blockHash.toLowerCase()
   &&x.transactionHash?.toLowerCase()===receipt.transactionHash.toLowerCase()
   &&quantity(x.blockNumber)===quantity(receipt.blockNumber)&&quantity(x.logIndex)<index
   &&d.eventName==='Transfer'&&sameAddress(d.args.from,job.client)&&sameAddress(d.args.to,BINDINGS.commerce)&&d.args.value===job.budget;
 });
 if(paid.length!==1)throw Error('UNIQUE_ESCROW_TOKEN_TRANSFER_REQUIRED');
 return {tx_hash:receipt.transactionHash,log_index:Number(index),block_number:Number(quantity(receipt.blockNumber)),
  block_hash:receipt.blockHash,block_timestamp:Number(quantity(header.timestamp)),chain_id:97,deployment:BINDINGS.commerce};
}
async function readContract(request,url,address,signature,args,block){
 const abi=parseAbi([signature]),functionName=abi[0].name;
 const data=encodeFunctionData({abi,functionName,args});
 return decodeFunctionResult({abi,functionName,data:await request(url,'eth_call',[{to:address,data},block])});
}
async function assertSeal(request,url,block){
 for(const target of Object.values(SEAL)){
  if(sha256Code(await request(url,'eth_getCode',[target.address,block]))!==target.runtime)throw Error('DEPLOYMENT_RUNTIME_SEAL_STOP');
  if(target.implementation){
   const word=await request(url,'eth_getStorageAt',[target.address,SLOT,block]);
   if(!/^0x0{24}[0-9a-fA-F]{40}$/.test(word)||!sameAddress('0x'+word.slice(-40),target.implementation))throw Error('IMPLEMENTATION_SEAL_STOP');
   if(sha256Code(await request(url,'eth_getCode',[target.implementation,block]))!==target.implementationRuntime)throw Error('IMPLEMENTATION_RUNTIME_SEAL_STOP');
  }
 }
}
async function verifyFundedJob({jobId,envelope,fundingTxHash,urls,now=Math.floor(Date.now()/1000),request=rpc}){
 if(typeof jobId!=='bigint'||jobId<=0n||jobId>BigInt(Number.MAX_SAFE_INTEGER)||!HASH.test(fundingTxHash)
  ||!Number.isSafeInteger(now)||urls?.length!==2||urls[0]===urls[1])throw Error('FUNDING_INPUT_STOP');
 const observations=[];
 for(const url of urls){
  if(quantity(await request(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
  const receipt=await request(url,'eth_getTransactionReceipt',[fundingTxHash]);
  if(!receipt||receipt.transactionHash?.toLowerCase()!==fundingTxHash.toLowerCase())throw Error('FUNDING_RECEIPT_UNAVAILABLE');
  const block=receipt.blockNumber;
  const header=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  await assertSeal(request,url,block);
  const job=await readContract(request,url,BINDINGS.commerce,JOB_SIGNATURE,[jobId],block);
  if(job.id!==jobId||![1,2,3,4,5].includes(job.status)||job.budget<=0n||!sameAddress(job.provider,BINDINGS.provider)
    ||!sameAddress(job.evaluator,SEAL.router.address)||!sameAddress(job.hook,SEAL.router.address))throw Error('FUNDED_PROVIDER_JOB_STOP');
  const token=await readContract(request,url,BINDINGS.commerce,'function jobPaymentToken(uint256) view returns (address)',[jobId],block);
  if(!sameAddress(token,BINDINGS.paymentToken))throw Error('JOB_PAYMENT_TOKEN_STOP');
  const selectedPolicy=await readContract(request,url,SEAL.router.address,'function jobPolicy(uint256) view returns (address)',[jobId],block);
  const routerCommerce=await readContract(request,url,SEAL.router.address,'function commerce() view returns (address)',[],block);
  if(!sameAddress(selectedPolicy,SEAL.policy.address)||!sameAddress(routerCommerce,BINDINGS.commerce))throw Error('JOB_POLICY_BINDING_STOP');
  const funding=validateReceipt(receipt,header,job);
  const draft=prepareQuote({task:envelope.request.task_description,terms:envelope.response.terms,
   priceWei:BigInt(envelope.response.terms.price),now:envelope.negotiated_at,
   ttlSeconds:envelope.quote_expires_at-envelope.negotiated_at});
  const signed=await verifyQuote(draft,envelope.provider_sig,{now:funding.block_timestamp});
  if(canonicalJson(signed)!==canonicalJson(envelope)||job.budget!==BigInt(draft.content.price))throw Error('ARCHIVED_QUOTE_STOP');
  const description=JSON.parse(job.description);
  if(description.protocol!=='pokter-job'||description.identity?.chainId!==97||description.identity?.tokenId!=='2583'
   ||!sameAddress(description.provider,BINDINGS.provider)||description.task!==envelope.request.task_description
   ||description.quote?.negotiationHash?.toLowerCase()!==envelope.negotiation_hash
   ||description.quote?.providerSignature?.toLowerCase()!==envelope.provider_sig.toLowerCase())throw Error('QUOTE_JOB_DESCRIPTION_STOP');
  const reconciled=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  if(reconciled.hash!==header.hash)throw Error('FUNDING_REORG_STOP');
  observations.push({funding,job});
 }
 if(stable(observations[0])!==stable(observations[1]))throw Error('RPC_FUNDING_DISAGREEMENT');
 const heights=await Promise.all(urls.map(url=>request(url,'eth_blockNumber').then(quantity)));
 const block='0x'+(heights[0]<heights[1]?heights[0]:heights[1]).toString(16),states=[];
 if(quantity(block)<BigInt(observations[0].funding.block_number))throw Error('CURRENT_HEAD_BEFORE_FUNDING');
 for(const url of urls){
  const header=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  if(Math.abs(now-Number(quantity(header.timestamp)))>60)throw Error('FRESH_HEAD_REQUIRED');
  await assertSeal(request,url,block);
  const job=await readContract(request,url,BINDINGS.commerce,JOB_SIGNATURE,[jobId],block);
  if(![1,2,3,4,5].includes(job.status)||!sameAddress(job.provider,BINDINGS.provider)
    ||job.description!==observations[0].job.description||job.budget!==observations[0].job.budget
    ||!sameAddress(job.client,observations[0].job.client)||!sameAddress(job.evaluator,SEAL.router.address)||!sameAddress(job.hook,SEAL.router.address))throw Error('CURRENT_JOB_STOP');
  if(!sameAddress(await readContract(request,url,BINDINGS.commerce,'function jobPaymentToken(uint256) view returns (address)',[jobId],block),BINDINGS.paymentToken)
    ||!sameAddress(await readContract(request,url,SEAL.router.address,'function jobPolicy(uint256) view returns (address)',[jobId],block),SEAL.policy.address)
    ||!sameAddress(await readContract(request,url,SEAL.router.address,'function commerce() view returns (address)',[],block),BINDINGS.commerce))throw Error('CURRENT_POLICY_TOKEN_STOP');
  const registry='0x8004A818BFB912233c491871b3d84c89A494BD9e';
  for(const method of ['ownerOf','getAgentWallet'])if(!sameAddress(await readContract(request,url,registry,`function ${method}(uint256) view returns (address)`,[2583n],block),BINDINGS.provider))throw Error('REGISTRY_PROVIDER_BINDING_STOP');
  const reconciled=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  if(reconciled.hash!==header.hash)throw Error('CURRENT_REORG_STOP');
  states.push({header,job});
 }
 if(stable(states[0])!==stable(states[1]))throw Error('RPC_CURRENT_JOB_DISAGREEMENT');
 const {header:currentHeader,job:current}=states[0];
 const production=request===rpc&&urls.every(url=>PUBLIC_RPCS.has(url));
 return {attested:production,synthetic:!production,funding_verified:true,agent_id:2583,chain_id:97,deployment:BINDINGS.commerce,source_kind:production?'OBSERVED':'SYNTHETIC',
  funding:observations[0].funding,block_number:Number(quantity(block)),block_hash:currentHeader.hash,
  block_timestamp:Number(quantity(currentHeader.timestamp)),job:{...current,statusName:['OPEN','FUNDED','SUBMITTED','COMPLETED','REJECTED','EXPIRED'][current.status]},
  verified_quote:{envelope,verified_at_funding:true},authority:'NONE',execution_enabled:false};
}
async function findFundingTx({jobId,envelope,url,request=rpc}){
 if(typeof jobId!=='bigint'||jobId<=0n||jobId>BigInt(Number.MAX_SAFE_INTEGER)
  ||!Number.isSafeInteger(envelope?.negotiated_at)||!Number.isSafeInteger(envelope?.quote_expires_at)
  ||envelope.negotiated_at<=0||envelope.quote_expires_at<=envelope.negotiated_at
  ||envelope.quote_expires_at-envelope.negotiated_at>900)throw Error('QUOTE_WINDOW_STOP');
 if(quantity(await request(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
 const head=quantity(await request(url,'eth_blockNumber'));
 async function header(n){const tag='0x'+n.toString(16);return validateHeader(await request(url,'eth_getBlockByNumber',[tag,false]),tag);}
 const latest=await header(head);if(quantity(latest.timestamp)<BigInt(envelope.negotiated_at))throw Error('QUOTE_FUTURE_STOP');
 async function lowerBound(timestamp){
  let high=head,step=64n,low=head>step?head-step:0n;
  while(quantity((await header(low)).timestamp)>=timestamp&&low>0n){high=low;step*=2n;low=head>step?head-step:0n;}
  let reads=0;
  while(low<high){if(++reads>54)throw Error('HEADER_SEARCH_BUDGET');const mid=(low+high)/2n;
   if(quantity((await header(mid)).timestamp)<timestamp)low=mid+1n;else high=mid;}
  return low;
 }
 const start=await lowerBound(BigInt(envelope.negotiated_at));
 const end=quantity(latest.timestamp)<BigInt(envelope.quote_expires_at)?head:await lowerBound(BigInt(envelope.quote_expires_at));
 if(end-start>16384n)throw Error('FUNDING_SCAN_BUDGET');
 const topics=encodeEventTopics({abi:FUNDED_ABI,eventName:'JobFunded',args:{jobId}}),logs=[];
 for(let from=start;from<=end;from+=512n){
  const to=from+511n<end?from+511n:end;
  const page=await request(url,'eth_getLogs',[{address:BINDINGS.commerce,topics,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16)}]);
  if(!Array.isArray(page)||page.length>64)throw Error('LOG_RESULT_BUDGET');logs.push(...page);
 }
 const valid=logs.filter(log=>sameAddress(log.address,BINDINGS.commerce)&&log.removed!==true&&log.topics?.[0]?.toLowerCase()===FUNDED_TOPIC.toLowerCase())
  .filter(log=>decodeEventLog({abi:FUNDED_ABI,data:log.data,topics:log.topics,strict:true}).args.jobId===jobId);
 if(valid.length!==1||!HASH.test(valid[0].transactionHash))throw Error('UNIQUE_FUNDING_TX_REQUIRED');
 // Receipt/header verification, time window and second RPC checks happen in verifyFundedJob.
 return valid[0].transactionHash;
}
module.exports={SEAL,FUNDED_ABI,TRANSFER_ABI,validateReceipt,verifyFundedJob,findFundingTx,assertSeal};
