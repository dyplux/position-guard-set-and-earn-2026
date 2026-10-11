/* Private Mac-only seller submission. Never imported by the public service. */
const fs=require('node:fs'),path=require('node:path');
const {ROOT,AUTHORITY,sha,directory,privateBytes,durable,sourceInventory,reserveJobNonce,authority}=require('./seller_submit_io.cjs');
const {packetDigest,validatePacket,assertPermit}=require('./seller_submit_guard.cjs');
const {URLS,preflight,latestLimits}=require('./seller_submit_preflight.cjs');
const {oneShot}=require('./seller_submit_execution.cjs');
const {BINDINGS,canonicalJson}=require('../marketplace/negotiation.cjs');
const {parseTransaction,recoverTransactionAddress}=require('../read_only/codec.cjs');
const {reconcile}=require('../marketplace/seller_reconcile.cjs');
const now=()=>Math.floor(Date.now()/1000);
function source(){const inventory=sourceInventory();return {inventory,digest:sha(canonicalJson(inventory))};}
function json(file,limit){return JSON.parse(privateBytes(file,limit));}
function recordSource(){
 if(process.platform!=='darwin')throw Error('MAC_OPERATOR_REQUIRED');
 fs.mkdirSync(AUTHORITY,{recursive:true,mode:0o700});directory(AUTHORITY);
 for(const name of ['state','grants','seals']){fs.mkdirSync(path.join(AUTHORITY,name),{mode:0o700,recursive:true});directory(path.join(AUTHORITY,name));}
 const sealed=source(),file=path.join(AUTHORITY,'seals',sealed.digest+'.json');
 if(fs.existsSync(file)){if(canonicalJson(json(file,4000000))!==canonicalJson(sealed.inventory))throw Error('RECORDED_SEAL_STOP');}
 else durable(file,sealed.inventory);
 return {status:'SOURCE_SNAPSHOT_ONLY',source_seal_sha256:sealed.digest,files:Object.keys(sealed.inventory.files).length,signatures:0,dispatches:0};
}
async function prepare(inputFile){
 const result=await preflight(json(inputFile),{sealSha256:source().digest});
 if(!result.production)throw Error('PUBLIC_PREFLIGHT_REQUIRED');
 validatePacket(result.packet,now());return result.packet;
}
async function broadcast(raw){
 // Exactly one transport attempt; read_only/rpc never exposes this method.
 const response=await fetch(URLS[0],{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[raw]}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('DISPATCH_HTTP_STOP');
 const chunks=[];let total=0;
 for await(const chunk of response.body){total+=chunk.length;if(total>4096)throw Error('DISPATCH_RESPONSE_LIMIT');chunks.push(Buffer.from(chunk));}
 const body=JSON.parse(Buffer.concat(chunks).toString());
 if(body.id!==1||body.error||typeof body.result!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(body.result))throw Error('DISPATCH_RESULT_STOP');
 return body.result;
}
async function verifySigned(raw,packet){
 const tx=parseTransaction(raw),p=packet.tx;
 if(tx.type!=='legacy'||tx.chainId!==97||tx.to?.toLowerCase()!==p.to.toLowerCase()
   ||(tx.value??0n)!==0n||tx.data!==p.data||tx.nonce!==p.nonce
   ||tx.gas!==BigInt(p.gas_limit)||tx.gasPrice!==BigInt(p.gas_price_wei)
   ||(await recoverTransactionAddress({serializedTransaction:raw})).toLowerCase()!==BINDINGS.provider.toLowerCase())throw Error('SIGNED_TX_BINDING_STOP');
}
async function execute(inputFile,packetFile){
 authority();
 const input=json(inputFile),packet=json(packetFile,32768);
 validatePacket(packet,now());
 const digest=packetDigest(packet),grantFile=path.join(AUTHORITY,'grants',digest+'.json');
 const grantBytes=privateBytes(grantFile,32768),grant=JSON.parse(grantBytes);
 const stateDir=path.join(AUTHORITY,'state'),jobLock=path.join(stateDir,'job-'+packet.job_id+'.lock');
 if(fs.existsSync(jobLock))throw Error('JOB_CONSUMED_RECONCILE_ONLY');
 function check(){
  if(canonicalJson(json(grantFile,32768))!==canonicalJson(grant))throw Error('GRANT_REVOKED_OR_CHANGED');
  const sealed=source(),recorded=json(path.join(AUTHORITY,'seals',packet.source_seal_sha256+'.json'),4000000);
  if(canonicalJson(recorded)!==canonicalJson(sealed.inventory))throw Error('LOCAL_SOURCE_SEAL_STOP');
  assertPermit(grant,packet,{now:now(),sealSha256:sealed.digest});
 }
 async function fresh(){
  check();
  const checked=await preflight(input,{approvedPacket:packet,sealSha256:packet.source_seal_sha256});
  if(!checked.production||checked.balance<BigInt(grant.min_reserve_wei)+BigInt(packet.tx.gas_limit)*BigInt(packet.tx.gas_price_wei))throw Error('FRESH_GRANT_RESERVE_STOP');
  check();
 }
 // A real reviewed public preflight is required before reserving any grant.
 await fresh();
 return oneShot({packet,
  reserve:()=>{
   const value={packet_sha256:digest,job_id:packet.job_id,nonce:packet.tx.nonce,grant_sha256:sha(grantBytes)};
   reserveJobNonce(stateDir,value);
  },
  journal:state=>durable(path.join(stateDir,'job-'+packet.job_id+'-'+state.status+'.json'),{...state,checked_at:now(),grant_sha256:sha(grantBytes)}),
  beforeSign:fresh,
  sign:async()=>{
   check();
   const config=json(path.join(AUTHORITY,'operator.json'),32768);
   if(config.provider!==BINDINGS.provider||typeof config.wallet_env!=='string'||!path.isAbsolute(config.wallet_env))throw Error('OPERATOR_WALLET_BINDING_STOP');
   const match=privateBytes(config.wallet_env,32768).toString().match(/^SET_EARN_CAMPAIGN_PRIVATE_KEY=['"]?(0x[0-9a-fA-F]{64})['"]?\s*$/m);
   if(!match)throw Error('EXPECTED_KEY_FIELD_REQUIRED');
   const {privateKeyToAccount}=require('../read_only/node_modules/viem/accounts');
   const account=privateKeyToAccount(match[1]);if(account.address!==BINDINGS.provider)throw Error('PROVIDER_KEY_STOP');
   check();
   return account.signTransaction({chainId:97,type:'legacy',to:packet.tx.to,data:packet.tx.data,value:0n,
    nonce:packet.tx.nonce,gas:BigInt(packet.tx.gas_limit),gasPrice:BigInt(packet.tx.gas_price_wei)});
  },
  verifySigned:raw=>verifySigned(raw,packet),
  beforeSend:async()=>{
   check();const p=packet.tx;
   const limits=await latestLimits({from:p.from,to:p.to,data:p.data,value:'0x0',nonce:'0x'+p.nonce.toString(16),
    gas:'0x'+BigInt(p.gas_limit).toString(16),gasPrice:'0x'+BigInt(p.gas_price_wei).toString(16)});
   if(limits.nonce!==p.nonce||limits.estimate>BigInt(p.gas_limit)||limits.gasPrice>BigInt(p.gas_price_wei)
     ||limits.balance<BigInt(grant.min_reserve_wei)+BigInt(p.gas_limit)*BigInt(p.gas_price_wei))throw Error('PREDISPATCH_STATE_CHANGED');
   check();
  },broadcast
 });
}
async function main(){
 const [mode,input,packet,...extra]=process.argv.slice(2);if(extra.length)throw Error('ARGUMENT_STOP');
 if(mode==='seal'&&!input&&!packet)return recordSource();
 if(mode==='prepare'&&input&&!packet)return prepare(input);
 if(mode==='execute'&&input&&packet)return execute(input,packet);
 if(mode==='reconcile'&&input&&packet)return reconcile(json(input,32768),packet);
 throw Error('MODE_STOP');
}
module.exports={prepare,execute,verifySigned,recordSource};
if(require.main===module)main().then(result=>{
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.status&&!['BROADCAST','SOURCE_SNAPSHOT_ONLY','COMPLETED','SUBMISSION_RECONCILED','RECONCILIATION_PENDING','WAIT_CONFIRMATIONS'].includes(result.status))process.exitCode=1;
}).catch(()=>{process.stdout.write(JSON.stringify({status:'SELLER_SUBMIT_STOP',execution_enabled:false})+'\n');process.exitCode=1;});
