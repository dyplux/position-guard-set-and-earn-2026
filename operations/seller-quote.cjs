/* Isolated one-shot quote signer. Never imports a wallet into the public server. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BINDINGS,prepareQuote,verifyQuote,canonicalJson}=require('../marketplace/negotiation.cjs');
const AUTHORITY_ROOT='/var/lib/position-guard-quote';
function digest(value){return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');}
function preflight(grant,draft,now){
 if(!grant||grant.state!=='AUTHORIZED'||grant.scope!=='SELLER_QUOTE_ONLY'
   ||grant.chain_id!==97||grant.agent_id!==2583||grant.provider!==BINDINGS.provider
   ||grant.commerce!==BINDINGS.commerce||grant.currency!==BINDINGS.paymentToken)throw Error('QUOTE_GRANT_REQUIRED');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(grant.expires_at)||grant.expires_at<=now
   ||grant.expires_at-now>900||draft.content.negotiated_at>now||draft.content.quote_expires_at<=now)throw Error('QUOTE_GRANT_EXPIRED');
 const expected=prepareQuote({task:draft.envelope.request.task_description,terms:draft.envelope.response.terms,
   priceWei:BigInt(draft.content.price),now:draft.content.negotiated_at,
   ttlSeconds:draft.content.quote_expires_at-draft.content.negotiated_at});
 if(canonicalJson(expected)!==canonicalJson(draft)||grant.content_sha256!==digest(draft)
   ||grant.price_wei!==draft.content.price||grant.max_signatures!==1||grant.transaction_dispatches!==0)throw Error('QUOTE_GRANT_BINDING_STOP');
 return {status:'QUOTE_SCHEMA_CHECK_ONLY',authority_verified:false,content_sha256:digest(draft),quote_hash:draft.envelope.negotiation_hash};
}
function privateDirectory(dir){
 const stat=fs.lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('OPERATOR_DIRECTORY_REQUIRED');
}
function privateFile(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||(stat.mode&0o777)!==0o600||stat.size>32768)throw Error('OPERATOR_FILE_REQUIRED');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}
function persist(file,value){
 const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
async function signQuote({draft}){
 if(typeof process.getuid!=='function'||process.getuid()!==0)throw Error('OPERATOR_AUTHORITY_REQUIRED');
 // Untrusted callers can't supply grants, state paths, or a wallet source.
 const stateDir=path.join(AUTHORITY_ROOT,'state'),grantDir=path.join(AUTHORITY_ROOT,'grants');
 privateDirectory(AUTHORITY_ROOT);privateDirectory(grantDir);privateDirectory(stateDir);
 const grantText=privateFile(path.join(grantDir,digest(draft)+'.json'));
 const grant=JSON.parse(grantText);
 const checked=preflight(grant,draft,Math.floor(Date.now()/1000));
 const base=path.join(stateDir,checked.content_sha256);
 // Lock is durable before key loading/signing. Any ambiguous crash needs reconciliation.
 persist(base+'.lock',{status:'SIGNATURE_MAY_EXIST',quote_hash:checked.quote_hash,dispatches:0});
 const match=privateFile(path.join(AUTHORITY_ROOT,'wallet.env')).match(/^SET_EARN_CAMPAIGN_PRIVATE_KEY=['"]?(0x[0-9a-fA-F]{64})['"]?\s*$/m);
 if(!match)throw Error('EXPECTED_KEY_FIELD_REQUIRED');
 const {privateKeyToAccount}=require('../read_only/node_modules/viem/accounts');
 const account=privateKeyToAccount(match[1]);
 if(account.address!==BINDINGS.provider)throw Error('OWNER_ADDRESS_STOP');
 const fresh=Math.floor(Date.now()/1000);preflight(grant,draft,fresh);
 const signature=await account.signMessage({message:{raw:draft.envelope.negotiation_hash}});
 preflight(grant,draft,Math.floor(Date.now()/1000));
 const envelope=await verifyQuote(draft,signature,{now:Math.floor(Date.now()/1000)});
 persist(base+'.quote.json',envelope);
 persist(base+'.result.json',{status:'SIGNED_QUOTE_PRIVATE',quote_hash:checked.quote_hash,signatures:1,dispatches:0,
   registry_binding:BINDINGS,grant_sha256:crypto.createHash('sha256').update(grantText).digest('hex'),
   agent_id_bound_by:'SIGNED_SERVICE_MARKER_AND_OPERATOR_GRANT_WITH_REGISTRY_JOB_BINDING_REQUIRED'});
 return {status:'SIGNED_QUOTE_PRIVATE',quote_file:base+'.quote.json',quote_hash:checked.quote_hash,signatures:1,dispatches:0};
}
module.exports={digest,preflight,signQuote};
if(require.main===module){
 (async()=>{
  const [draftFile]=process.argv.slice(2);if(!draftFile)throw Error('DRAFT_REQUIRED');
  const result=await signQuote({draft:JSON.parse(fs.readFileSync(draftFile))});
  process.stdout.write(JSON.stringify(result)+'\n');
 })().catch(()=>{process.stderr.write('QUOTE_SIGNING_STOP\n');process.exitCode=1;});
}
