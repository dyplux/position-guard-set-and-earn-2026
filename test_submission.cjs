const {test}=require('node:test');const assert=require('node:assert/strict');
const {prepareSubmission}=require('./marketplace/submission.cjs');
const {BINDINGS,canonicalJson}=require('./marketplace/negotiation.cjs');
const {decodeFunctionData,parseAbi,hexToString}=require('./read_only/codec.cjs');
const crypto=require('node:crypto');
const router='0xD7d36D66d2F1B608A0F943f722D27e3744f66F25',policy='0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA';
function fixture(){return {job:{chain_id:97,deployment:BINDINGS.commerce,attested:false,job:{id:'7',provider:BINDINGS.provider,
 evaluator:router,hook:router,budget:'100',expiredAt:'2000000100',statusName:'FUNDED'}},manifestBytes:Buffer.from(canonicalJson({
 version:1,chain_id:97,job_id:7,contracts:{commerce:BINDINGS.commerce,router,policy},response:{content:'SYNTHETIC ação',content_type:'text/plain'}})),now:2000000000};}
test('submit commits keccak of exact bytes and fixed delivery URL',()=>{
 const result=prepareSubmission(fixture());assert.equal(result.signing_ready,false);assert.equal(result.job_attested,false);
 const decoded=decodeFunctionData({abi:parseAbi(['function submit(uint256,bytes32,bytes)']),data:result.tx.data});
 assert.equal(decoded.args[0],7n);assert.equal(decoded.args[1],result.manifest_keccak256);
 assert.equal(JSON.parse(hexToString(decoded.args[2])).deliverable_url,result.deliverable_url);
 const independentSha=crypto.createHash('sha256').update(fixture().manifestBytes).digest('hex');
 assert.equal(result.tx.from,'0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982');
 assert.equal(result.tx.to,'0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE');
 assert.equal(result.deliverable_url,'https://positionguard.dyplux.com/deliverables/erc8183:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7/'+independentSha+'.json');
 assert.notEqual(result.manifest_sha256,result.manifest_keccak256.slice(2));
});
test('deployment, router and manifest targets cannot drift',()=>{
 for(const field of ['deployment','evaluator','hook']){
  const input=fixture();if(field==='deployment')input.job.deployment='0x'+'1'.repeat(40);else input.job.job[field]='0x'+'1'.repeat(40);
  assert.throws(()=>prepareSubmission(input));}
 for(const field of ['commerce','router','policy']){
  const input=fixture();const manifest=JSON.parse(input.manifestBytes);manifest.contracts[field]='0x'+'1'.repeat(40);
  input.manifestBytes=Buffer.from(canonicalJson(manifest));assert.throws(()=>prepareSubmission(input));}
});
test('expired job, wrong provider and altered/noncanonical bytes stop',()=>{
 for(const change of [{expiredAt:'2000000000'},{provider:'0x'+'1'.repeat(40)},{statusName:'SUBMITTED'}]){
  const input=fixture();input.job.job={...input.job.job,...change};assert.throws(()=>prepareSubmission(input));}
 const input=fixture();input.manifestBytes=Buffer.from(input.manifestBytes.toString()+' ');assert.throws(()=>prepareSubmission(input),/CANONICAL/);
 const other=fixture();const manifest=JSON.parse(other.manifestBytes);manifest.job_id=8;other.manifestBytes=Buffer.from(canonicalJson(manifest));assert.throws(()=>prepareSubmission(other),/BINDING/);
});
test('lossy numeric identifiers and budgets cannot prepare submission',()=>{
 for(const change of [{id:true},{id:'07'},{budget:1.5},{expiredAt:'-1'}]){
  const input=fixture();input.job.job={...input.job.job,...change};assert.throws(()=>prepareSubmission(input));}
});
