/* Private IPC reader. Input on stdin, output captured by the Python worker. */
const fs=require('node:fs');
const {readJob}=require('./erc8183.cjs');
const {BINDINGS}=require('./negotiation.cjs');
const {findFundingTx,verifyFundedJob}=require('./funding.cjs');
const URLS=['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
async function handle(input){
 if(!input||typeof input.job_id!=='string'||!/^[1-9][0-9]{0,15}$/.test(input.job_id)||BigInt(input.job_id)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('JOB_ID_STOP');
 const jobId=BigInt(input.job_id);
 if(input.mode==='describe'){
  const observed=await readJob({url:URLS[0],chainId:97,jobId});
  if(observed.job.provider.toLowerCase()!==BINDINGS.provider.toLowerCase())throw Error('PROVIDER_STOP');
  const envelope=JSON.parse(observed.job.description);
  if(envelope.protocol!=='pokter-job'||envelope.identity?.chainId!==97||envelope.identity?.tokenId!=='2583'
    ||typeof envelope.quote?.negotiationHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(envelope.quote.negotiationHash))throw Error('POKTER_DESCRIPTION_STOP');
  return {job_id:input.job_id,quote_hash:envelope.quote.negotiationHash.toLowerCase(),attested:false};
 }
 if(input.mode!=='verify'||!input.envelope)throw Error('VERIFICATION_INPUT_STOP');
 const fundingTxHash=await findFundingTx({jobId,envelope:input.envelope,url:URLS[0]});
 return verifyFundedJob({jobId,envelope:input.envelope,fundingTxHash,urls:URLS});
}
module.exports={handle};
if(require.main===module){
 (async()=>{
  const stat=fs.fstatSync(0); // stdin is the private request channel, never a command argument.
  const raw=fs.readFileSync(0,'utf8');if(Buffer.byteLength(raw)>32768)throw Error('INPUT_LIMIT');
  const result=await handle(JSON.parse(raw));
  process.stdout.write(JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v)+'\n');
 })().catch(()=>{process.stderr.write('FUNDING_READER_STOP\n');process.exitCode=1;});
}
