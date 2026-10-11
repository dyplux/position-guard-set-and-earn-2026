/* Verify an already-issued quote. No wallet, signing, RPC or publication. */
const fs=require('node:fs'),crypto=require('node:crypto');
const {BINDINGS,prepareQuote,verifyQuote,canonicalJson}=require('./negotiation.cjs');
const PROFILE=require('./service_profile.json');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function need(ok){if(!ok)throw Error('PREISSUED_QUOTE_INVALID')}
function envelopeSha(envelope){return crypto.createHash('sha256').update(canonicalJson(envelope)).digest('hex')}
async function validateOffer(input,{verify=verifyQuote}={}){
 need(exact(input,['envelope','task','now']));const {envelope:e,task,now}=input;
 need(Number.isSafeInteger(now)&&now>0&&typeof task==='string'
  &&/^Assess Venus Core testnet position for wallet 0x[0-9a-fA-F]{40}\. I consent to public JSON delivery retained for 45 days\.$/.test(task));
 need(exact(e,['negotiated_at','quote_expires_at','chain_id','verifying_contract','request','response','negotiation_hash','provider_sig']));
 need(exact(e.request,['task_description'])&&e.request.task_description===task
  &&exact(e.response,['accepted','terms'])&&e.response.accepted===true);
 const t=e.response.terms;need(exact(t,['deliverables','quality_standards','price','currency'])
  &&t.deliverables===PROFILE.deliverables&&t.quality_standards===PROFILE.quality_standards
  &&typeof t.price==='string'&&/^[1-9][0-9]{0,18}$/.test(t.price)&&BigInt(t.price)<=10n**18n
  &&t.currency===BINDINGS.paymentToken&&e.chain_id===97&&e.verifying_contract===BINDINGS.commerce
  &&typeof e.negotiation_hash==='string'&&/^0x[0-9a-f]{64}$/.test(e.negotiation_hash)
  &&typeof e.provider_sig==='string'&&/^0x[0-9a-fA-F]{130}$/.test(e.provider_sig));
 need(Number.isSafeInteger(e.negotiated_at)&&e.negotiated_at>0&&e.negotiated_at<=now
  &&Number.isSafeInteger(e.quote_expires_at)&&e.quote_expires_at>now
  &&e.quote_expires_at-e.negotiated_at<=900&&e.quote_expires_at-e.negotiated_at>0);
 const draft=prepareQuote({task,terms:t,priceWei:BigInt(t.price),now:e.negotiated_at,
  ttlSeconds:e.quote_expires_at-e.negotiated_at});
 need(draft.envelope.negotiation_hash===e.negotiation_hash);
 const verified=await verify(draft,e.provider_sig,{now});
 need(canonicalJson(verified)===canonicalJson(e));
 return {status:'VERIFIED_PREISSUED_QUOTE',envelope:e,envelope_sha256:envelopeSha(e)};
}
module.exports={validateOffer,envelopeSha};
if(require.main===module)(async()=>{
 const raw=fs.readFileSync(0);need(raw.length>0&&raw.length<=32768);
 const result=await validateOffer(JSON.parse(raw));
 process.stdout.write(JSON.stringify(result)+'\n');
})().catch(()=>{process.stderr.write('PREISSUED_QUOTE_INVALID\n');process.exitCode=1});
