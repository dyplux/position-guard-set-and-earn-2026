/* One-shot ordering; dependencies are operator callbacks, never HTTP input. */
const {keccak256}=require('../read_only/codec.cjs');
const {packetDigest,validatePacket}=require('./seller_submit_guard.cjs');
async function oneShot({packet,reserve,journal,beforeSign,sign,verifySigned,beforeSend,broadcast,
 clock=()=>Math.floor(Date.now()/1000)}){
 validatePacket(packet,clock());
 const state={job_id:packet.job_id,packet_sha256:packetDigest(packet),nonce:packet.tx.nonce,
  signature_count:0,signature_may_exist:false,dispatch_count:0,completed_onchain:false};
 // Only the process that acquired this job may append its execution journal.
 let reserved=false;
 try{
  reserve();reserved=true;
  await beforeSign();validatePacket(packet,clock());
  state.status='SIGNING_BEGUN';state.signature_may_exist=true;journal({...state});
  const signed=await sign();
  state.signature_count=1;
  if(typeof signed!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(signed))throw Error('SIGNED_BYTES_STOP');
  state.tx_hash=keccak256(signed);state.status='SIGNED';journal({...state});
  await verifySigned(signed);await beforeSend();validatePacket(packet,clock());
  state.status='DISPATCH_BEGUN';state.dispatch_count=1;journal({...state});
  const returned=await broadcast(signed);
  if(typeof returned!=='string'||returned.toLowerCase()!==state.tx_hash)throw Error('DISPATCH_HASH_STOP');
  state.status='BROADCAST';journal({...state});
 }catch(error){
  if(!reserved&&error.reservation_owned!==true)throw error;
  if(!reserved)state.reservation_incomplete=true;
  state.status=state.dispatch_count?'AMBIGUOUS_RECONCILE_ONLY':state.signature_may_exist?'SIGNATURE_RECONCILE_ONLY':'STOP_BEFORE_SIGNING';
  state.stop_code=/^[A-Z_]+$/.test(error.message)?error.message:'SANITIZED_STOP';journal({...state});
 }
 return state;
}
module.exports={oneShot};
