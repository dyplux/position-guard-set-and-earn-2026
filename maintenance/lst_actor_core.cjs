'use strict';
/* Preparation core. CLI has no signer, authority loader or provider transport. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const B=path.resolve(__dirname,'..'),v=require(B+'/read_only/codec.cjs');
const {parseStrict,fields,rawUint,epoch,freeze}=require('./lst_wire.cjs');
const {canonical}=require('./lst_canonical.cjs'),io=require('./lst_actor_io.cjs');
const PIN=freeze({chain_id:97,payer:'0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982',wbnb:'0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',market:'0x231dED0Dfc99634e52EE1a1329586bc970d773b3',controller:'0x596B11acAACF03217287939f88d63b51d3771704',seed_cap_raw:'2000000000000000',borrow_cap_raw:'500000000000000',close_cap_raw:'600000000000000',gas_cap_wei:'1000000000000000',reserve_wei:'10000000000000000',gas_price_wei:'200000000'});
const ROOT=path.join(os.homedir(),'.config','position-guard-lst-trial'),SHARED_NONCES=path.join(os.homedir(),'.config','position-guard-outgoing-nonces');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),digest=x=>hash(canonical(x)),same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hex64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),uint=rawUint;
const STAGES=freeze({WRAP:['wbnb','function deposit() payable','seed'],WRAP_REPAY:['wbnb','function deposit() payable','repay'],APPROVE_SEED:['wbnb','function approve(address,uint256) returns(bool)','seed'],MINT:['market','function mint(uint256) returns(uint256)','seed'],ENTER:['controller','function enterMarkets(address[]) returns(uint256[])','zero'],BORROW:['market','function borrow(uint256) returns(uint256)','borrow'],PARTIAL_REPAY:['market','function repayBorrow(uint256) returns(uint256)','repay'],CLOSE:['market','function repayBorrow(uint256) returns(uint256)','repay'],APPROVE_REPAY:['wbnb','function approve(address,uint256) returns(bool)','repay'],CLEAR_ALLOWANCE:['wbnb','function approve(address,uint256) returns(bool)','zero'],REDEEM:['market','function redeemUnderlying(uint256) returns(uint256)','seed'],UNWRAP:['wbnb','function withdraw(uint256)','seed']});
function stageIntent(stage,amount){
 if(!Object.hasOwn(STAGES,stage))throw Error('STAGE_STOP');const [target,signature,cap]=STAGES[stage],n=uint(amount,{positive:cap!=='zero'});
 if(cap==='zero'&&n!==0n||cap==='seed'&&n>BigInt(PIN.seed_cap_raw)||cap==='borrow'&&n>BigInt(PIN.borrow_cap_raw)||cap==='repay'&&n>BigInt(PIN.close_cap_raw))throw Error('AMOUNT_CAP_STOP');
 const abi=v.parseAbi([signature]),args=stage.startsWith('WRAP')?[]:stage==='ENTER'?[[PIN.market]]:stage.includes('APPROVE')||stage==='CLEAR_ALLOWANCE'?[PIN.market,n]:[n];
 return{to:PIN[target],data:v.encodeFunctionData({abi,functionName:abi[0].name,args}),value_wei:stage.startsWith('WRAP')?amount:'0'};
}
function packetValid(p,t,{historical=false}={}){
 fields(p,['schema_version','status','trial_id','stage','chain_id','from','to','nonce','amount_raw','value_wei','data','gas_limit','gas_price_wei','prepared_at','deadline','source_sha256','profile_sha256','history_sha256','observation_sha256','authority','execution_enabled']);
 if(p.schema_version!==1||p.status!=='UNSIGNED_LST_STAGE'||p.chain_id!==97||p.from!==PIN.payer||p.authority!=='NONE'||p.execution_enabled!==false||!hex64(p.trial_id)||!hex64(p.source_sha256)||!hex64(p.profile_sha256)||!hex64(p.history_sha256)||!hex64(p.observation_sha256))throw Error('PACKET_SCOPE_STOP');
 epoch(p.prepared_at);epoch(p.deadline);if(!historical){epoch(t);if(t<p.prepared_at||t>=p.deadline)throw Error('PACKET_EXPIRY_STOP');}if(p.deadline-p.prepared_at<1||p.deadline-p.prepared_at>120)throw Error('PACKET_WINDOW_STOP');
 if(!Number.isSafeInteger(p.nonce)||p.nonce<0||p.nonce>Number.MAX_SAFE_INTEGER-1||uint(p.gas_limit)<21000n||uint(p.gas_limit)>1000000n||p.gas_price_wei!==PIN.gas_price_wei)throw Error('TX_LIMIT_STOP');
 uint(p.value_wei);const intent=stageIntent(p.stage,p.amount_raw);if(p.to!==intent.to||p.data!==intent.data||p.value_wei!==intent.value_wei)throw Error('CALLDATA_STOP');
 return p;
}
function prepare(input){fields(input,['trial_id','stage','amount_raw','nonce','gas_limit','prepared_at','source_sha256','profile_sha256','history_sha256','observation_sha256']);const intent=stageIntent(input.stage,input.amount_raw),packet={schema_version:1,status:'UNSIGNED_LST_STAGE',...input,chain_id:97,from:PIN.payer,...intent,gas_price_wei:PIN.gas_price_wei,deadline:input.prepared_at+120,authority:'NONE',execution_enabled:false};packetValid(packet,input.prepared_at);return freeze(packet);}
async function verifySigned(raw,p,{historical=false,now=Math.floor(Date.now()/1000)}={}){
 packetValid(p,now,{historical});if(typeof raw!=='string'||!/^0x(?:[a-fA-F0-9]{2}){1,8000}$/.test(raw))throw Error('RAW_STOP');const x=v.parseTransaction(raw);
 if(x.type!=='legacy'||x.chainId!==97||!same(x.to,p.to)||x.data!==p.data||(x.value??0n)!==BigInt(p.value_wei)||x.nonce!==p.nonce||x.gas!==BigInt(p.gas_limit)||x.gasPrice!==BigInt(p.gas_price_wei)||!same(await v.recoverTransactionAddress({serializedTransaction:raw}),PIN.payer))throw Error('SIGNED_INTENT_STOP');return v.keccak256(raw);
}
function preflightBinding(result,p,t){
 fields(result,['packet_sha256','source_sha256','profile_sha256','history_sha256','observation_sha256','observed_at','common_block_number','common_block_hash','nonce','pending_nonce','native_balance_wei','gas_used_wei','gas_reserved_wei','derived_stage']);
 if(result.packet_sha256!==digest(p)||result.source_sha256!==p.source_sha256||result.profile_sha256!==p.profile_sha256||result.history_sha256!==p.history_sha256||!hex64(result.observation_sha256)
  ||!/^0x[a-fA-F0-9]{64}$/.test(result.common_block_hash)||!Number.isSafeInteger(result.common_block_number)||result.common_block_number<0
  ||epoch(result.observed_at)>t||t-result.observed_at>30||result.nonce!==p.nonce||result.pending_nonce!==p.nonce)throw Error('PREFLIGHT_BINDING_STOP');
 fields(result.derived_stage,['stage','amount_raw','to','data','value_wei']);
 if(digest(result.derived_stage)!==digest({stage:p.stage,amount_raw:p.amount_raw,to:p.to,data:p.data,value_wei:p.value_wei}))throw Error('DERIVED_STAGE_STOP');
 const fee=BigInt(p.gas_limit)*BigInt(p.gas_price_wei),balance=uint(result.native_balance_wei),used=uint(result.gas_used_wei),reserved=uint(result.gas_reserved_wei);
 if(used+reserved+fee>BigInt(PIN.gas_cap_wei)||balance<BigInt(PIN.reserve_wei)+BigInt(p.value_wei)+fee)throw Error('GAS_OR_RESERVE_STOP');return digest(result);
}
function authorityBinding(result,p,t){
 fields(result,['packet_sha256','source_sha256','profile_sha256','history_sha256','expires_at']);
 if(result.packet_sha256!==digest(p)||result.source_sha256!==p.source_sha256||result.profile_sha256!==p.profile_sha256||result.history_sha256!==p.history_sha256||epoch(result.expires_at)<=t||result.expires_at>p.deadline)throw Error('AUTHORITY_BINDING_STOP');return result;
}
const reservations=new WeakSet();
function reserve(p,{state_directory=ROOT,shared_nonce_directory=SHARED_NONCES,now=Math.floor(Date.now()/1000)}={}){
 packetValid(p,now);const local=io.directory(state_directory),shared=io.directory(shared_nonce_directory);if(local===shared)throw Error('DIRECTORY_SCOPE_STOP');
 const id=digest(p),record={packet_sha256:id,trial_id:p.trial_id,stage:p.stage,nonce:p.nonce,source_sha256:p.source_sha256,profile_sha256:p.profile_sha256,history_sha256:p.history_sha256};let first=false;
 try{io.durable(path.join(local,'slot-'+p.trial_id+'-'+p.stage+'.lock'),record);first=true;io.durable(path.join(shared,'nonce-'+p.nonce+'.lock'),record);io.durable(path.join(local,'nonce-'+p.nonce+'.lock'),record);io.durable(path.join(local,'packet-'+id+'.lock'),record);}
 catch(e){if(first||e.private_file_created)e.reservation_owned=true;throw e;}
 const reservation=freeze({packet_sha256:id,source_sha256:p.source_sha256,trial_id:p.trial_id,stage:p.stage,nonce:p.nonce,state_directory:local,shared_nonce_directory:shared});reservations.add(reservation);return reservation;
}
function reservationValid(res,p){
 if(!reservations.has(res)||res.packet_sha256!==digest(p)||res.source_sha256!==p.source_sha256)throw Error('RESERVATION_STOP');
 for(const file of [path.join(res.state_directory,'slot-'+res.trial_id+'-'+res.stage+'.lock'),path.join(res.state_directory,'packet-'+res.packet_sha256+'.lock'),path.join(res.state_directory,'nonce-'+res.nonce+'.lock'),path.join(res.shared_nonce_directory,'nonce-'+res.nonce+'.lock')]){
  const record=io.privateRead(file);if(record.packet_sha256!==res.packet_sha256||record.source_sha256!==p.source_sha256||record.profile_sha256!==p.profile_sha256||record.history_sha256!==p.history_sha256||record.nonce!==p.nonce||record.stage!==p.stage||record.trial_id!==p.trial_id)throw Error('RESERVATION_DRIFT_STOP');}
}
const journalSequences=new WeakMap();
function journal(res,p,entry){reservationValid(res,p);fields(entry,['packet_sha256','status','signature_attempts','signature_count','dispatch_reserved_count','dispatch_count','tx_hash'],['stop_code','preflight_sha256']);
 if(entry.packet_sha256!==res.packet_sha256||!['RESERVED','SIGNING_BEGUN','SIGNED','DISPATCH_BEGUN','BROADCAST','STOP_BEFORE_SIGNING','RECONCILIATION_ONLY'].includes(entry.status)
  ||['signature_attempts','signature_count','dispatch_reserved_count','dispatch_count'].some(k=>!Number.isInteger(entry[k])||entry[k]<0||entry[k]>1)||entry.signature_count>entry.signature_attempts||entry.dispatch_count>entry.dispatch_reserved_count||entry.dispatch_reserved_count>entry.signature_count||entry.tx_hash!==null&&!/^0x[a-fA-F0-9]{64}$/.test(entry.tx_hash))throw Error('JOURNAL_STOP');
 const seq=(journalSequences.get(res)||0)+1;journalSequences.set(res,seq);return io.durable(path.join(res.state_directory,res.packet_sha256+'-journal-'+String(seq).padStart(2,'0')+'.json'),entry);
}
async function persistRaw(res,p,raw,{now=Math.floor(Date.now()/1000)}={}){reservationValid(res,p);const txHash=await verifySigned(raw,p,{now});io.durable(path.join(res.state_directory,res.packet_sha256+'-signed.json'),{raw,tx_hash:txHash,packet:p,packet_sha256:res.packet_sha256,source_sha256:p.source_sha256});return txHash;}
async function oneShotInternal(p,cb,verify){
 const keys=['check','preflight','reserve','journal','sign','persist','broadcast'];if(!cb||keys.some(k=>typeof cb[k]!=='function')||cb.clock!==undefined&&typeof cb.clock!=='function')throw Error('TRUSTED_CALLBACK_REQUIRED');
 const clock=cb.clock||(()=>Math.floor(Date.now()/1000)),id=digest(p),state={packet_sha256:id,status:'RESERVED',signature_attempts:0,signature_count:0,dispatch_reserved_count:0,dispatch_count:0,tx_hash:null};let owned=false;
 const bound=()=>{packetValid(p,clock());if(digest(p)!==id)throw Error('PACKET_CHANGED_STOP');};
 async function authority(){bound();authorityBinding(await cb.check(),p,clock());bound();}
 async function preflight(){await authority();state.preflight_sha256=preflightBinding(await cb.preflight(),p,clock());bound();}
 async function log(status){state.status=status;await cb.journal({...state});bound();}
 try{
  await preflight();await cb.reserve();owned=true;await log('RESERVED');await preflight();state.signature_attempts=1;await log('SIGNING_BEGUN');await authority();const raw=await cb.sign();state.signature_count=1;
  await authority();state.tx_hash=await verify(raw,p,{now:clock()});const persisted=await cb.persist(raw,state.tx_hash);if(persisted!==state.tx_hash)throw Error('RAW_PERSISTENCE_BINDING_STOP');await log('SIGNED');
  await preflight();if(await verify(raw,p,{now:clock()})!==state.tx_hash)throw Error('RAW_CHANGED_STOP');state.dispatch_reserved_count=1;await log('DISPATCH_BEGUN');await authority();bound();state.dispatch_count=1;
  const returned=await cb.broadcast(raw);if(!same(returned,state.tx_hash))throw Error('DISPATCH_HASH_STOP');await log('BROADCAST');
 }catch(e){if(!owned&&!e.reservation_owned)throw e;state.status=state.signature_attempts||state.dispatch_reserved_count?'RECONCILIATION_ONLY':'STOP_BEFORE_SIGNING';state.stop_code=/^[A-Z0-9_]+$/.test(e.message)?e.message:'SANITIZED_STOP';try{await cb.journal({...state});}catch{}}
 return freeze({...state,authority:'NONE',execution_enabled:false,receipt_confirmed:false});
}
function oneShot(p,cb){return oneShotInternal(p,cb,verifySigned);}
const FIXTURE_RAW='SYNTHETIC_FIXTURE_NOT_A_TRANSACTION',FIXTURE_HASH=v.keccak256(v.toBytes(FIXTURE_RAW));
async function simulateOneShot(p,cb){return {...await oneShotInternal(p,cb,async raw=>{if(raw!==FIXTURE_RAW)throw Error('SYNTHETIC_RAW_STOP');return FIXTURE_HASH;}),kind:'SYNTHETIC',actual_signatures:0,actual_dispatches:0};}
function normalizedState(x){
 fields(x,['native_balance_wei','wbnb_balance_raw','allowance_raw','vtoken_balance_raw','debt_raw','entered','gas_used_wei']);
 for(const k of ['native_balance_wei','wbnb_balance_raw','allowance_raw','vtoken_balance_raw','debt_raw','gas_used_wei'])uint(x[k]);if(typeof x.entered!=='boolean')throw Error('ENTERED_TYPE_STOP');return x;
}
function effectPolicy(p,before,after,fee){
 normalizedState(before);normalizedState(after);const n=BigInt(p.amount_raw),wb=BigInt(before.wbnb_balance_raw),wa=BigInt(after.wbnb_balance_raw),db=BigInt(before.debt_raw),da=BigInt(after.debt_raw),vb=BigInt(before.vtoken_balance_raw),va=BigInt(after.vtoken_balance_raw);
 const unchangedWbnb=()=>{if(wa!==wb)throw Error('WBNB_EFFECT_STOP');},unchangedVtokens=()=>{if(va!==vb)throw Error('VTOKEN_EFFECT_STOP');};
 const ab=BigInt(before.allowance_raw),aa=BigInt(after.allowance_raw);
 if(p.stage!=='BORROW'&&db===0n&&da!==0n)throw Error('UNEXPECTED_DEBT_STOP');
 if(p.stage==='MINT'){if(ab<n||aa!==ab-n)throw Error('MINT_ALLOWANCE_EFFECT_STOP');}
 else if(p.stage==='PARTIAL_REPAY'||p.stage==='CLOSE'){if(wb<=wa||ab<wb-wa||aa!==ab-(wb-wa))throw Error('REPAY_ALLOWANCE_EFFECT_STOP');}
 else if(!p.stage.includes('APPROVE')&&p.stage!=='CLEAR_ALLOWANCE'&&aa!==ab)throw Error('ALLOWANCE_DRIFT_STOP');
 if(BigInt(after.gas_used_wei)!==BigInt(before.gas_used_wei)+fee||BigInt(after.gas_used_wei)>BigInt(PIN.gas_cap_wei)||BigInt(after.native_balance_wei)<BigInt(PIN.reserve_wei))throw Error('RECEIPT_GAS_RESERVE_STOP');
 const nativeDelta=p.stage==='UNWRAP'?n:p.stage.startsWith('WRAP')?-n:0n;
 if(BigInt(after.native_balance_wei)!==BigInt(before.native_balance_wei)+nativeDelta-fee)throw Error('NATIVE_EFFECT_STOP');
 if(p.stage.startsWith('WRAP')){if(wa!==wb+n)throw Error('WRAP_EFFECT_STOP');unchangedVtokens();}
 else if(p.stage.includes('APPROVE')||p.stage==='CLEAR_ALLOWANCE'){if(after.allowance_raw!==p.amount_raw)throw Error('ALLOWANCE_EFFECT_STOP');unchangedWbnb();unchangedVtokens();if(p.stage==='CLEAR_ALLOWANCE'&&(db!==0n||da!==0n))throw Error('CLEAR_BEFORE_ZERO_DEBT_STOP');}
 else if(p.stage==='MINT'){if(wb<n||wa!==wb-n||va<=vb||db!==0n||da!==0n)throw Error('MINT_EFFECT_STOP');}
 else if(p.stage==='ENTER'){if(before.entered!==false||after.entered!==true)throw Error('ENTER_EFFECT_STOP');unchangedWbnb();unchangedVtokens();}
 else if(p.stage==='BORROW'){if(db!==0n||wa!==wb+n||da<n||after.entered!==true)throw Error('BORROW_EFFECT_STOP');unchangedVtokens();}
 else if(p.stage==='PARTIAL_REPAY'||p.stage==='CLOSE'){if(wb<=wa||wb-wa>n||db===0n||p.stage==='CLOSE'&&da!==0n||p.stage==='PARTIAL_REPAY'&&(da===0n||da>=db))throw Error('REPAY_EFFECT_STOP');unchangedVtokens();}
 else if(p.stage==='REDEEM'){if(db!==0n||da!==0n||wa!==wb+n||va>=vb)throw Error('REDEEM_EFFECT_STOP');}
 else if(p.stage==='UNWRAP'){if(wb<n||wa!==wb-n||db!==0n||da!==0n)throw Error('UNWRAP_EFFECT_STOP');unchangedVtokens();}
 else throw Error('STAGE_STOP');
 if(!['ENTER','BORROW'].includes(p.stage)&&after.entered!==before.entered)throw Error('ENTERED_DRIFT_STOP');return true;
}
function verifyReceiptEffects(p,txHash,before,rows){
 packetValid(p,0,{historical:true});normalizedState(before);if(typeof txHash!=='string'||!/^0x[a-fA-F0-9]{64}$/.test(txHash)||!Array.isArray(rows)||rows.length!==2)throw Error('RECEIPT_ROWS_STOP');
 const urls=require('./lst_reader.cjs').URLS;
 const effects=rows.map((row,i)=>{
  fields(row,['url','receipt','block_header','block_header_after','head_number','state','source_sha256','profile_sha256','history_sha256','observation_sha256']);
  if(row.url!==urls[i]||row.source_sha256!==p.source_sha256||row.profile_sha256!==p.profile_sha256||row.history_sha256!==p.history_sha256||!hex64(row.observation_sha256))throw Error('RECEIPT_SCOPE_STOP');
  const r=require(B+'/read_only/rpc.cjs'),receipt=row.receipt,header=r.validateHeader(row.block_header,receipt?.blockNumber),again=r.validateHeader(row.block_header_after,receipt?.blockNumber),height=uint(row.head_number);
  if(receipt?.status!=='0x1'||!same(receipt.transactionHash,txHash)||!same(receipt.from,PIN.payer)||!same(receipt.to,p.to)||!same(receipt.blockHash,header.hash)||header.hash!==again.hash||header.timestamp!==again.timestamp||height<r.quantity(receipt.blockNumber)+11n)throw Error('RECEIPT_BINDING_STOP');
  const gas=r.quantity(receipt.gasUsed),price=r.quantity(receipt.effectiveGasPrice);if(gas<=0n||gas>BigInt(p.gas_limit)||price!==BigInt(PIN.gas_price_wei))throw Error('RECEIPT_FEE_STOP');
  const fee=gas*price;effectPolicy(p,before,row.state,fee);return{block_number:receipt.blockNumber,block_hash:receipt.blockHash,fee_wei:fee.toString(),state:row.state};
 });if(digest(effects[0])!==digest(effects[1]))throw Error('RECEIPT_EFFECT_QUORUM_STOP');
 return freeze({status:'RECEIPT_EFFECT_POLICY_PASS',kind:'POLICY_CHECK_ONLY',original_tx_hash:txHash,packet_sha256:digest(p),...effects[0],authority:'NONE',execution_enabled:false,financial_ready:false,full_position_deleted:false});
}
module.exports={PIN,ROOT,SHARED_NONCES,STAGES,parseStrict,digest,stageIntent,prepare,packetValid,verifySigned,preflightBinding,authorityBinding,reserve,journal,persistRaw,oneShot,simulateOneShot,FIXTURE_RAW,FIXTURE_HASH,normalizedState,effectPolicy,verifyReceiptEffects};
if(require.main===module)console.log(JSON.stringify({status:'NO_EXECUTION',authority:'NONE',execution_enabled:false,signer_status:'NO_SIGNER',financial_ready:false}));
