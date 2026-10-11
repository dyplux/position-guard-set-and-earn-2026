const {test}=require('node:test');const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {verifySigned}=require('./operations/seller-submit.cjs');
const {privateKeyToAccount}=require('./read_only/node_modules/viem/accounts');
const {BINDINGS}=require('./marketplace/negotiation.cjs');
const {rpc}=require('./read_only/rpc.cjs');
test('command has no default execution and stops without operator inputs',()=>{
 for(const args of [[],['execute','/nonexistent-position-guard-input','/nonexistent-position-guard-packet']]){
  const result=cp.spawnSync(process.execPath,['operations/seller-submit.cjs',...args],{cwd:__dirname,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),{status:'SELLER_SUBMIT_STOP',execution_enabled:false});
 }
});
test('a real serialized signature from a public test key cannot impersonate F9',async()=>{
 // Public deterministic fixture key, not a participant or operator wallet.
 const account=privateKeyToAccount('0x'+'0'.repeat(63)+'1');
 const packet={tx:{to:BINDINGS.commerce,data:'0x12345678',nonce:3,gas_limit:'125000',gas_price_wei:'1000000000'}};
 const signed=await account.signTransaction({chainId:97,type:'legacy',to:packet.tx.to,data:packet.tx.data,
  value:0n,nonce:3,gas:125000n,gasPrice:1000000000n});
 await assert.rejects(()=>verifySigned(signed,packet),/SIGNED_TX_BINDING_STOP/);
});
test('new nonce reads do not add broadcast to read-only RPC',async()=>{
 await assert.rejects(()=>rpc('https://not-used.invalid','eth_sendRawTransaction',['0x01']),/READ_ONLY_METHOD_REQUIRED/);
});
