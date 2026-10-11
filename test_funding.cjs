const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateReceipt,FUNDED_ABI,TRANSFER_ABI,verifyFundedJob}=require('./marketplace/funding.cjs');
const {BINDINGS}=require('./marketplace/negotiation.cjs');
const {encodeEventTopics,encodeAbiParameters,parseAbiParameters}=require('./read_only/codec.cjs');
const hash='0x'+'a'.repeat(64),tx='0x'+'b'.repeat(64),client='0x'+'1'.repeat(40);
function fixture(){
 const job={id:7n,client,provider:BINDINGS.provider,budget:100n};
 const base={blockNumber:'0x10',blockHash:hash,transactionHash:tx,removed:false};
 const data=encodeAbiParameters(parseAbiParameters('uint256'),[100n]);
 const funded={...base,address:BINDINGS.commerce,logIndex:'0x2',data,
  topics:encodeEventTopics({abi:FUNDED_ABI,eventName:'JobFunded',args:{jobId:7n,client,provider:BINDINGS.provider}})};
 const transfer={...base,address:BINDINGS.paymentToken,logIndex:'0x1',data,
  topics:encodeEventTopics({abi:TRANSFER_ABI,eventName:'Transfer',args:{from:client,to:BINDINGS.commerce}})};
 return {job,header:{number:'0x10',timestamp:'0x77359400',hash},receipt:{status:'0x1',transactionHash:tx,blockNumber:'0x10',blockHash:hash,logs:[transfer,funded]}};
}
test('funded event and token transfer bind client/provider/budget/block',()=>{
 const x=fixture();const proof=validateReceipt(x.receipt,x.header,x.job);
 assert.equal(proof.tx_hash,tx);assert.equal(proof.log_index,2);assert.equal(proof.block_timestamp,2000000000);
});
test('forged contract, wrong client, missing payment and duplicate event stop',()=>{
 for(const mutate of [x=>{x.receipt.logs[1].address=client},x=>{x.job.client=BINDINGS.provider},
  x=>{x.receipt.logs.shift()},x=>{x.receipt.logs.push(x.receipt.logs[1])},
  x=>{x.receipt.logs[1].removed=true},x=>{x.receipt.blockHash='0x'+'c'.repeat(64)},
  x=>{x.job.budget=101n},x=>{x.receipt.status='0x0'}]){
  const x=fixture();mutate(x);assert.throws(()=>validateReceipt(x.receipt,x.header,x.job));
 }
});
test('unpaid or wrong-chain data cannot reach attestation',async()=>{
 await assert.rejects(verifyFundedJob({jobId:7n,envelope:{},fundingTxHash:tx,urls:['a','b'],now:2000000000,
  request:async()=> '0x38'}),/CHAIN_STOP/);
 await assert.rejects(verifyFundedJob({jobId:7n,envelope:{},fundingTxHash:tx,urls:['a','a'],now:2000000000}),/INPUT_STOP/);
});
