/* Fixed-RPC, read-only provider event scan. Never accepts HTTP attestations. */
const fs=require('node:fs');
const {encodeEventTopics,decodeEventLog}=require('../read_only/codec.cjs');
const {rpc,quantity,validateHeader}=require('../read_only/rpc.cjs');
const {BINDINGS,canonicalJson}=require('./negotiation.cjs');
const {FUNDED_ABI,assertSeal}=require('./funding.cjs');
const URLS=Object.freeze(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);
const HASH=/^0x[0-9a-f]{64}$/;
const tag=n=>'0x'+n.toString(16);
async function scan(input,{request=rpc,seal=assertSeal}={}){
 if(!input||Object.keys(input).sort().join(',')!=='from_block,previous_hash'
   ||!Number.isSafeInteger(input.from_block)||input.from_block<1
   ||(input.previous_hash!==null&&!HASH.test(input.previous_hash)))throw Error('SCAN_INPUT_STOP');
 const start=BigInt(input.from_block),anchors=[],heights=[];
 for(const url of URLS){
  if(quantity(await request(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
  heights.push(quantity(await request(url,'eth_blockNumber')));
  const block=tag(start-1n);
  anchors.push(validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block));
 }
 if(['number','hash','timestamp'].some(key=>anchors[0][key]!==anchors[1][key]))throw Error('RPC_ANCHOR_DISAGREEMENT');
 if(input.previous_hash!==null&&anchors[0].hash.toLowerCase()!==input.previous_hash)throw Error('SCAN_REORG_STOP');
 const production=request===rpc&&seal===assertSeal;
 const base={attested:production,synthetic:!production,chain_id:97,deployment:BINDINGS.commerce,provider:BINDINGS.provider,
  from_block:input.from_block,previous_hash:anchors[0].hash.toLowerCase()};
 const height=heights[0]<heights[1]?heights[0]:heights[1];
 if(height<12n||height-12n<start)return {...base,status:'WAIT_CONFIRMATIONS',events:[]};
 const safe=height-12n,stop=safe<start+127n?safe:start+127n,block=tag(stop),states=[];
 const topics=encodeEventTopics({abi:FUNDED_ABI,eventName:'JobFunded',args:{provider:BINDINGS.provider}});
 for(const url of URLS){
  const head=validateHeader(await request(url,'eth_getBlockByNumber',[block,false]),block);
  // Discovery pins the current confirmed deployment; funded proof is re-derived by FundingReader.
  await seal(request,url,tag(safe));
  let logs;
  try{logs=await request(url,'eth_getLogs',[{address:BINDINGS.commerce,topics,fromBlock:tag(start),toBlock:block}]);}
  catch{
   logs=[];let receiptCount=0,logCount=0;
   // Four bounded read requests at a time keep discovery ahead of new blocks.
   for(let first=start;first<=stop;first+=4n){
    const numbers=[];for(let n=first;n<=stop&&n<first+4n;n++)numbers.push(n);
    const pages=await Promise.all(numbers.map(n=>request(url,'eth_getBlockReceipts',[tag(n)])));
    for(let offset=0;offset<pages.length;offset++){
    const n=numbers[offset],receipts=pages[offset];
    if(!Array.isArray(receipts)||(receiptCount+=receipts.length)>512)throw Error('SCAN_RECEIPT_BUDGET_STOP');
    for(const receipt of receipts){
     if(!Array.isArray(receipt.logs)||(logCount+=receipt.logs.length)>2048)throw Error('SCAN_RECEIPT_LOG_STOP');
     for(const log of receipt.logs)if(log.address?.toLowerCase()===BINDINGS.commerce.toLowerCase()
       &&log.topics?.[0]?.toLowerCase()===topics[0].toLowerCase()&&log.topics?.[3]?.toLowerCase()===topics[3].toLowerCase()){
      if(receipt.status!=='0x1'||receipt.blockNumber!==tag(n)||log.blockNumber!==tag(n)
        ||receipt.transactionHash!==log.transactionHash||receipt.blockHash!==log.blockHash)throw Error('SCAN_RECEIPT_PROVENANCE_STOP');
      logs.push(log);
     }
    }
    }
   }
  }
  if(!Array.isArray(logs)||logs.length>64)throw Error('SCAN_LOG_BUDGET_STOP');
  const events=[],headers=new Map(),seen=new Set();
  for(const log of logs){
   if(log.address?.toLowerCase()!==BINDINGS.commerce.toLowerCase()||log.removed===true
     ||!HASH.test(log.transactionHash)||!HASH.test(log.blockHash))throw Error('SCAN_LOG_PROVENANCE_STOP');
   const n=quantity(log.blockNumber),index=quantity(log.logIndex);
   if(n<start||n>stop||index>BigInt(Number.MAX_SAFE_INTEGER))throw Error('SCAN_LOG_RANGE_STOP');
   const decoded=decodeEventLog({abi:FUNDED_ABI,data:log.data,topics:log.topics,strict:true});
   if(decoded.eventName!=='JobFunded'||decoded.args.provider.toLowerCase()!==BINDINGS.provider.toLowerCase()
     ||decoded.args.jobId<=0n||decoded.args.jobId>BigInt(Number.MAX_SAFE_INTEGER)||decoded.args.amount<=0n)throw Error('SCAN_EVENT_STOP');
   if(!headers.has(log.blockNumber))headers.set(log.blockNumber,validateHeader(await request(url,'eth_getBlockByNumber',[log.blockNumber,false]),log.blockNumber));
   if(headers.get(log.blockNumber).hash.toLowerCase()!==log.blockHash)throw Error('SCAN_EVENT_BLOCK_STOP');
   const key=log.transactionHash+':'+index.toString();if(seen.has(key))throw Error('SCAN_DUPLICATE_STOP');seen.add(key);
   events.push({job_id:Number(decoded.args.jobId),tx_hash:log.transactionHash,log_index:Number(index),
    block_number:Number(n),block_hash:log.blockHash});
  }
  events.sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
  for(const [number,header] of [[tag(start-1n),anchors[0]],[block,head],...headers]){
   const checked=validateHeader(await request(url,'eth_getBlockByNumber',[number,false]),number);
   if(checked.hash!==header.hash)throw Error('SCAN_REORG_STOP');
  }
  states.push({events,to_hash:head.hash.toLowerCase()});
 }
 if(canonicalJson(states[0])!==canonicalJson(states[1]))throw Error('RPC_SCAN_DISAGREEMENT');
 return {...base,status:'SCANNED',to_block:Number(stop),...states[0]};
}
module.exports={scan};
if(require.main===module)(async()=>{
 const raw=fs.readFileSync(0);if(raw.length>1024)throw Error('SCAN_INPUT_LIMIT');
 process.stdout.write(JSON.stringify(await scan(JSON.parse(raw)))+'\n');
})().catch(error=>{
 process.stdout.write(JSON.stringify({status:error.message==='SCAN_REORG_STOP'?'REORG_STOP':'SCAN_UNAVAILABLE',execution_enabled:false})+'\n');
 process.exitCode=1;
});
