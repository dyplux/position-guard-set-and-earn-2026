/* Prepare an ERC-8183 submit call from exact persisted bytes. No signer. */
const crypto=require('node:crypto');
const {keccak256,toHex,parseAbi,encodeFunctionData,getAddress}=require('../read_only/codec.cjs');
const {BINDINGS,canonicalJson}=require('./negotiation.cjs');
const ROUTER='0xD7d36D66d2F1B608A0F943f722D27e3744f66F25';
const POLICY='0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA';
function uint(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
 if(typeof value==='bigint'&&value>=0n&&value<2n**256n)return value;
 if(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n)return BigInt(value);
 throw Error('CANONICAL_UINT_REQUIRED');
}
function prepareSubmission({job,manifestBytes,now}){
 if(!Number.isSafeInteger(now)||now<0||job?.chain_id!==97||job?.deployment?.toLowerCase()!==BINDINGS.commerce.toLowerCase())throw Error('JOB_CHAIN_STOP');
 const data=job.job;
 if(!data||data.statusName!=='FUNDED'||data.provider.toLowerCase()!==BINDINGS.provider.toLowerCase()
   ||uint(data.expiredAt)<=BigInt(now)||uint(data.budget)<=0n||uint(data.id)<=0n||uint(data.id)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('FUNDED_PROVIDER_JOB_REQUIRED');
 if(data.evaluator.toLowerCase()!==ROUTER.toLowerCase()||data.hook.toLowerCase()!==ROUTER.toLowerCase())throw Error('ROUTER_BINDING_STOP');
 if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length===0||manifestBytes.length>262144)throw Error('MANIFEST_BYTES_REQUIRED');
 const text=manifestBytes.toString('utf8');const manifest=JSON.parse(text);
 if(canonicalJson(manifest)!==text)throw Error('CANONICAL_MANIFEST_REQUIRED');
 if(manifest.version!==1||manifest.chain_id!==97||uint(manifest.job_id)!==uint(data.id)
   ||getAddress(manifest.contracts.commerce)!==getAddress(BINDINGS.commerce)
   ||getAddress(manifest.contracts.router)!==getAddress(ROUTER)
   ||getAddress(manifest.contracts.policy)!==getAddress(POLICY))throw Error('MANIFEST_JOB_BINDING_STOP');
 const sha256=crypto.createHash('sha256').update(manifestBytes).digest('hex');
 const digest=keccak256(toHex(manifestBytes));
 const deliverableUrl=`https://positionguard.dyplux.com/deliverables/erc8183:97:${BINDINGS.commerce.toLowerCase()}:${data.id}/${sha256}.json`;
 const optParams=toHex(canonicalJson({deliverable_url:deliverableUrl}));
 return {status:'SUBMISSION_PREPARED_UNSIGNED',authority:'NONE',execution_enabled:false,
   job_attested:job.attested===true,signing_ready:false,manifest_sha256:sha256,manifest_keccak256:digest,
   deliverable_url:deliverableUrl,required_checks:['reviewed_job_reader','quote_binding','fresh_job','public_exact_bytes','owner_grant','latest_simulation'],
   tx:{from:BINDINGS.provider,to:BINDINGS.commerce,value:'0x0',data:encodeFunctionData({
    abi:parseAbi(['function submit(uint256,bytes32,bytes)']),functionName:'submit',args:[BigInt(data.id),digest,optParams]})}};
}
module.exports={prepareSubmission};
