/* Unsigned BNB SDK quote codec, chain97 assessment only. No key or signer. */
const {keccak256,toBytes,getAddress,recoverMessageAddress} = require('../read_only/codec.cjs');
const BINDINGS=Object.freeze({chainId:97,agentId:2583,
  provider:'0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982',
  commerce:'0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',
  paymentToken:'0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565'});
const SERVICE_MARKER='Position Guard ERC-8004 97/2583; assess_venus_position; read-only';
function canonicalJson(value){
  function sort(v){
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'){if(!Number.isSafeInteger(v))throw Error('SAFE_INTEGER_REQUIRED');return v;}
    if(Array.isArray(v))return v.map(sort);
    if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));
    throw Error('JSON_VALUE_REQUIRED');
  }
  return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
function clean(value){
  if(typeof value!=='string'||!value.trim()||value.length>2000)throw Error('BOUNDED_TEXT_REQUIRED');
  const sanitized=value.replaceAll('[','(').replaceAll(']',')').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
  if(!sanitized.trim())throw Error('NONEMPTY_TERMS_REQUIRED');
  return sanitized;
}
function prepareQuote({task,terms,priceWei,now,ttlSeconds=900}){
  if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>900)throw Error('QUOTE_CLOCK_STOP');
  if(typeof priceWei!=='bigint'||priceWei<=0n||priceWei>10n**18n)throw Error('TESTNET_PRICE_CAP_STOP');
  const normalizedTerms={deliverables:clean(terms?.deliverables),quality_standards:clean(terms?.quality_standards)};
  if(!normalizedTerms.quality_standards.endsWith(SERVICE_MARKER))normalizedTerms.quality_standards+=' | '+SERVICE_MARKER;
  normalizedTerms.quality_standards=clean(normalizedTerms.quality_standards);
  const normalizedTask=clean(task);
  const content={version:1,negotiated_at:now,task:normalizedTask,terms:normalizedTerms,
    price:priceWei.toString(),currency:getAddress(BINDINGS.paymentToken),quote_expires_at:now+ttlSeconds,
    chain_id:97,verifying_contract:getAddress(BINDINGS.commerce)};
  const envelope={negotiated_at:now,quote_expires_at:content.quote_expires_at,chain_id:97,
    verifying_contract:content.verifying_contract,request:{task_description:task},
    response:{accepted:true,terms:{...normalizedTerms,price:content.price,currency:content.currency}},
    negotiation_hash:keccak256(toBytes(canonicalJson(content))),provider_sig:null};
  return {status:'UNSIGNED_QUOTE_ONLY',authority:'NONE',execution_enabled:false,skill:'assess_venus_position',bindings:BINDINGS,content,envelope};
}
async function verifyQuote(draft,signature,{now}){
  if(!Number.isSafeInteger(now)||now<draft.content.negotiated_at||now>=draft.content.quote_expires_at)throw Error('QUOTE_EXPIRED_OR_FUTURE');
  const expected=prepareQuote({task:draft.envelope.request.task_description,
    terms:draft.envelope.response.terms,priceWei:BigInt(draft.content.price),
    now:draft.content.negotiated_at,ttlSeconds:draft.content.quote_expires_at-draft.content.negotiated_at});
  if(canonicalJson(expected.content)!==canonicalJson(draft.content)
    ||canonicalJson(expected.envelope)!==canonicalJson(draft.envelope)
    ||canonicalJson(draft.bindings)!==canonicalJson(BINDINGS)||draft.skill!==expected.skill)throw Error('QUOTE_CONTENT_BINDING_STOP');
  const signer=await recoverMessageAddress({message:{raw:draft.envelope.negotiation_hash},signature});
  if(signer.toLowerCase()!==BINDINGS.provider.toLowerCase())throw Error('QUOTE_PROVIDER_STOP');
  return {...draft.envelope,provider_sig:signature};
}
module.exports={BINDINGS,canonicalJson,prepareQuote,verifyQuote};
