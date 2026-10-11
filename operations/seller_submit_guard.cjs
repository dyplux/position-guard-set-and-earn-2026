/* Pure schema guard for one exact ERC-8183 submit transaction. No I/O or authority. */
const crypto=require('node:crypto');
const {BINDINGS,canonicalJson}=require('../marketplace/negotiation.cjs');
const {decodeFunctionData,encodeFunctionData,parseAbi}=require('../read_only/codec.cjs');

const ABI=parseAbi(['function submit(uint256,bytes32,bytes)']);
const SCOPE='ERC8183_SUBMIT_ONLY';
const UINT256_MAX=2n**256n-1n;
const FEE_CAP=1000000000000000n;
const PACKET_KEYS=['agent_id','chain_id','deliverable_url','expires_at','funding_tx_hash','job_id','manifest_keccak256','manifest_sha256','provider','quote_hash','schema_version','scope','source_seal_sha256','tx'];
const TX_KEYS=['data','from','gas_limit','gas_price_wei','nonce','to','value'];
const GRANT_KEYS=['agent_id','chain_id','commerce','expires_at','max_dispatches','max_gas_cost_wei','max_signatures','min_reserve_wei','packet_sha256','provider','scope','source_seal_sha256','state'];

function exactObject(value,keys,label){
 if(value===null||typeof value!=='object'||Array.isArray(value)
   ||Object.keys(value).sort().join('\0')!==keys.join('\0'))throw Error(`${label}_SCHEMA_STOP`);
}
function decimal(value,{positive=false,max}={}){
 if(typeof value!=='string'||!(/^(0|[1-9][0-9]{0,77})$/).test(value))throw Error('CANONICAL_DECIMAL_STOP');
 const n=BigInt(value);
 if((positive&&n===0n)||(max!==undefined&&n>max))throw Error('DECIMAL_RANGE_STOP');
 return n;
}
function lowerSha(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
function lowerHash(value){return typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);}
function safeClock(now){if(!Number.isSafeInteger(now)||now<0)throw Error('CLOCK_STOP');}
function bytesText(hex){
 if(typeof hex!=='string'||!/^0x(?:[0-9a-f]{2})*$/.test(hex))throw Error('OPTPARAMS_BYTES_STOP');
 const bytes=Buffer.from(hex.slice(2),'hex');
 const text=bytes.toString('utf8');
 if(!Buffer.from(text,'utf8').equals(bytes))throw Error('OPTPARAMS_UTF8_STOP');
 return text;
}

function packetDigest(packet){
 return crypto.createHash('sha256').update(canonicalJson(packet),'utf8').digest('hex');
}

function validatePacket(packet,now){
 safeClock(now);exactObject(packet,PACKET_KEYS,'PACKET');
 if(packet.schema_version!==1||packet.scope!==SCOPE||packet.chain_id!==97||packet.agent_id!==2583
   ||packet.provider!==BINDINGS.provider)throw Error('PACKET_BINDING_STOP');
 const jobId=decimal(packet.job_id,{positive:true,max:BigInt(Number.MAX_SAFE_INTEGER)});
 if(!lowerHash(packet.funding_tx_hash)||!lowerHash(packet.quote_hash)||!lowerHash(packet.manifest_keccak256)
   ||!lowerSha(packet.manifest_sha256)||!lowerSha(packet.source_seal_sha256))throw Error('PACKET_DIGEST_FORMAT_STOP');
 if(!Number.isSafeInteger(packet.expires_at)||packet.expires_at<=now||packet.expires_at-now>900)throw Error('PACKET_EXPIRY_STOP');
 const expectedUrl=`https://positionguard.dyplux.com/deliverables/erc8183:97:${BINDINGS.commerce.toLowerCase()}:${packet.job_id}/${packet.manifest_sha256}.json`;
 if(packet.deliverable_url!==expectedUrl)throw Error('DELIVERABLE_URL_STOP');

 exactObject(packet.tx,TX_KEYS,'TX');
 const tx=packet.tx;
 if(tx.from!==BINDINGS.provider||tx.to!==BINDINGS.commerce||tx.value!=='0x0'
   ||!Number.isSafeInteger(tx.nonce)||tx.nonce<0)throw Error('TX_BINDING_STOP');
 const gasLimit=decimal(tx.gas_limit,{positive:true,max:500000n});
 const gasPrice=decimal(tx.gas_price_wei,{positive:true});
 const gasCost=gasLimit*gasPrice;
 if(gasCost>FEE_CAP)throw Error('GAS_COST_STOP');

 let decoded;
 try{decoded=decodeFunctionData({abi:ABI,data:tx.data});}catch{throw Error('SUBMIT_CALLDATA_STOP');}
 if(decoded.functionName!=='submit'||decoded.args.length!==3||decoded.args[0]!==jobId
   ||decoded.args[1]!==packet.manifest_keccak256)throw Error('SUBMIT_ARGUMENT_STOP');
 let optParams;
 try{const text=bytesText(decoded.args[2]);optParams=JSON.parse(text);
   exactObject(optParams,['deliverable_url'],'OPTPARAMS');
   if(canonicalJson(optParams)!==text||optParams.deliverable_url!==expectedUrl)throw Error('OPTPARAMS_BINDING_STOP');
 }catch(error){if(error.message?.endsWith('_STOP'))throw error;throw Error('OPTPARAMS_STOP');}
 const canonicalData=encodeFunctionData({abi:ABI,functionName:'submit',args:[jobId,packet.manifest_keccak256,decoded.args[2]]});
 if(tx.data!==canonicalData)throw Error('NONCANONICAL_CALLDATA_STOP');
 return {gas_cost_wei:gasCost.toString()};
}

function assertPermit(grant,packet,{now,sealSha256}={}){
 const checked=validatePacket(packet,now);exactObject(grant,GRANT_KEYS,'GRANT');
 if(!lowerSha(sealSha256))throw Error('SEAL_INPUT_STOP');
 if(grant.state!=='AUTHORIZED'||grant.scope!==SCOPE||grant.chain_id!==97||grant.agent_id!==2583
   ||grant.provider!==BINDINGS.provider||grant.commerce!==BINDINGS.commerce
   ||grant.packet_sha256!==packetDigest(packet)||grant.source_seal_sha256!==packet.source_seal_sha256
   ||grant.source_seal_sha256!==sealSha256||grant.expires_at!==packet.expires_at
   ||grant.max_signatures!==1||grant.max_dispatches!==1)throw Error('GRANT_BINDING_STOP');
 const maxGas=decimal(grant.max_gas_cost_wei,{max:FEE_CAP});
 const reserve=decimal(grant.min_reserve_wei,{max:UINT256_MAX});
 if(maxGas<BigInt(checked.gas_cost_wei)||reserve<FEE_CAP)throw Error('GRANT_LIMIT_STOP');
 return {status:'SUBMIT_SCHEMA_CHECK_ONLY',authority_verified:false};
}

module.exports={packetDigest,validatePacket,assertPermit};
