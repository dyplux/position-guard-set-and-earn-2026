const {test}=require('node:test');const assert=require('node:assert/strict');
const {prepareQuote,verifyQuote,canonicalJson,BINDINGS}=require('./marketplace/negotiation.cjs');
const {keccak256,toBytes}=require('./read_only/codec.cjs');
const input={task:'Assess Venus wallet 0x1111111111111111111111111111111111111111',
 terms:{deliverables:'JSON assessment',quality_standards:'Read-only; no funds moved'},priceWei:10n**16n,now:2000000000};
test('SDK quote content is canonically hashed and testnet bound',()=>{
 const draft=prepareQuote(input);assert.equal(draft.envelope.negotiation_hash,keccak256(toBytes(canonicalJson(draft.content))));
 assert.equal(draft.content.chain_id,97);assert.equal(draft.content.currency,BINDINGS.paymentToken);
 assert.equal(draft.envelope.provider_sig,null);assert.equal(draft.status,'UNSIGNED_QUOTE_ONLY');
 assert.match(draft.content.terms.quality_standards,/ERC-8004 97\/2583; assess_venus_position/);
});
test('unicode and sanitization conform to SDK claim encoding',()=>{
 assert.equal(canonicalJson({z:'ação',a:1}),'{'+'"a":1,"z":"a\\u00e7\\u00e3o"}');
 const draft=prepareQuote({...input,task:'[Venus]\u0000 test'});assert.equal(draft.content.task,'(Venus) test');
 assert.equal(draft.envelope.request.task_description,'[Venus]\u0000 test');
});
test('bad amounts, missing terms and invalid expiry stop',()=>{
 for(const change of [{priceWei:0n},{priceWei:1},{priceWei:10n**18n+1n},{now:NaN},{ttlSeconds:901},{terms:{} },
   {terms:{deliverables:'JSON',quality_standards:'x'.repeat(2000)}}])assert.throws(()=>prepareQuote({...input,...change}));
});
test('expiry and altered content fail before signature recovery',async()=>{
 const draft=prepareQuote(input);
 await assert.rejects(verifyQuote(draft,'0x',{now:input.now+900}),/QUOTE_EXPIRED/);
 draft.content.price='2';await assert.rejects(verifyQuote(draft,'0x',{now:input.now}),/BINDING/);
});
test('all bindings and term fields reject relabeling',async()=>{
 const changes=[d=>{d.bindings={...d.bindings,agentId:2574}},d=>{d.bindings={...d.bindings,provider:'0x'+'1'.repeat(40)}},
  d=>{d.skill='repay'},d=>{d.content.chain_id=56},d=>{d.content.currency='0x'+'1'.repeat(40)},
  d=>{d.content.verifying_contract='0x'+'2'.repeat(40)},d=>{d.content.task='Different task'},
  d=>{d.content.terms.deliverables='Other deliverable'},d=>{d.content.terms.quality_standards='Move funds'}];
 for(const change of changes){const d=prepareQuote(input);d.content=structuredClone(d.content);change(d);
  await assert.rejects(verifyQuote(d,'0x',{now:input.now}),/BINDING/);}
 assert.throws(()=>prepareQuote({...input,task:'\u0000'}),/NONEMPTY/);
 await assert.rejects(verifyQuote(prepareQuote(input),'0x',{now:input.now-1}),/FUTURE/);
});
