const {test}=require('node:test');const assert=require('node:assert/strict');
const {prepareQuote,BINDINGS}=require('./marketplace/negotiation.cjs');
const {preflight,digest,signQuote}=require('./operations/seller-quote.cjs');
function fixture(){
 const draft=prepareQuote({task:'Assess Venus wallet 0x'+'1'.repeat(40),terms:{deliverables:'JSON receipt',quality_standards:'Read-only'},priceWei:10n**16n,now:2000000000});
 return {draft,grant:{state:'AUTHORIZED',scope:'SELLER_QUOTE_ONLY',chain_id:97,agent_id:2583,
  provider:BINDINGS.provider,commerce:BINDINGS.commerce,currency:BINDINGS.paymentToken,
  expires_at:2000000060,content_sha256:digest(draft),price_wei:'10000000000000000',max_signatures:1,transaction_dispatches:0}};
}
test('quote-only grant pins one exact draft and zero transactions',()=>{
 const {draft,grant}=fixture();assert.equal(preflight(grant,draft,2000000000).status,'QUOTE_SCHEMA_CHECK_ONLY');
 assert.equal(preflight(grant,draft,2000000000).authority_verified,false);
 for(const change of [{state:'PROPOSED_NOT_AUTHORIZED'},{chain_id:56},{price_wei:'1'},{max_signatures:2},
  {transaction_dispatches:1},{expires_at:2000000000},{content_sha256:'0'.repeat(64)}])assert.throws(()=>preflight({...grant,...change},draft,2000000000));
});
test('unauthorized grant stops before any filesystem or key access',async()=>{
 const {draft,grant}=fixture();await assert.rejects(signQuote({draft,grant,
  stateDir:'/unavailable',walletEnv:'/never-read'}));
});
