const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateOffer,envelopeSha}=require('./marketplace/offer_verifier.cjs');
const {prepareQuote,BINDINGS}=require('./marketplace/negotiation.cjs');
const PROFILE=require('./marketplace/service_profile.json');
const task='Assess Venus Core testnet position for wallet '+BINDINGS.provider+'. I consent to public JSON delivery retained for 45 days.';
function input(){const draft=prepareQuote({task,terms:PROFILE,priceWei:10n**17n,now:2000000000,ttlSeconds:900});return {envelope:{...draft.envelope,provider_sig:'0x'+'a'.repeat(130)},task,now:2000000001}}
const fake={verify:async(d,s)=>({...d.envelope,provider_sig:s})};
test('synthetic verifier seam preserves exact envelope and hashes; no signature created',async()=>{
 const i=input(),result=await validateOffer(i,fake);assert.deepEqual(result.envelope,i.envelope);
 assert.equal(result.status,'VERIFIED_PREISSUED_QUOTE');assert.equal(result.envelope_sha256,envelopeSha(i.envelope));
});
test('domains, terms, unsupported actions, price and hash conflicts fail',async()=>{
 for(const change of [i=>i.envelope.chain_id=56,i=>i.envelope.verifying_contract='0x'+'1'.repeat(40),
  i=>i.envelope.response.terms.currency='0x'+'2'.repeat(40),i=>i.envelope.response.terms.price='0',
  i=>i.envelope.response.terms.price=1,i=>i.envelope.response.terms.price='1000000000000000001',
  i=>i.envelope.response.terms.deliverables='trade',i=>i.envelope.response.terms.extra=true,
  i=>i.task='Assess Venus wallet '+BINDINGS.provider,i=>i.envelope.request.task_description+='x',
  i=>i.envelope.negotiation_hash='0x'+'b'.repeat(64),i=>i.envelope.extra=true,
  i=>i.envelope.response.accepted=false,i=>i.envelope.provider_sig='0x']){
  const i=input();change(i);await assert.rejects(validateOffer(i,fake));
 }
});
test('clock, expiry and modified verifier result fail',async()=>{
 for(const change of [i=>i.now=true,i=>i.now=2000000900,i=>i.now=1999999999,
  i=>i.envelope.quote_expires_at=2000000901,i=>i.envelope.negotiated_at=NaN]){
  const i=input();change(i);await assert.rejects(validateOffer(i,fake));
 }
 await assert.rejects(validateOffer(input(),{verify:async(d,s)=>({...d.envelope,provider_sig:s,extra:true})}));
});
test('real recovery rejects a dummy signature; synthetic seam is not production evidence',async()=>{
 await assert.rejects(validateOffer(input()));
});
