const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildUnsigned,TARGETS} = require('./maintenance/unsigned.cjs');
const {decodeFunctionData,parseAbi} = require('./read_only/codec.cjs');
const {rpc,validateHeader} = require('./read_only/rpc.cjs');
const {simulateUnsigned} = require('./maintenance/simulate.cjs');
const owner = '0x1111111111111111111111111111111111111111';
test('native supply units and calldata round trip',()=>{
  const result=buildUnsigned({chainId:56,owner,kind:'SUPPLY_COLLATERAL',amountWei:123n});
  assert.equal(result.tx.value,'0x7b'); assert.equal(result.tx.to,TARGETS.vbnb);
  assert.equal(result.tx.data,'0x1249c58b'); assert.equal(result.execution_enabled,false);
});
test('enter uses mainnet market array',()=>{
  const result=buildUnsigned({chainId:56,owner,kind:'ENTER_COLLATERAL_MARKET'});
  const decoded=decodeFunctionData({abi:parseAbi(['function enterMarkets(address[]) returns (uint256[])']),data:result.tx.data});
  assert.deepEqual(decoded.args,[[TARGETS.vbnb]]); assert.equal(result.tx.value,'0x0');
});
test('both repayment kinds bind borrower and refund sender to owner',()=>{
  for(const kind of ['REPAY_BOUNDED','CLOSE_REMAINING_DEBT']){
    const result=buildUnsigned({chainId:56,owner,kind,amountWei:42n});
    assert.equal(result.tx.to,TARGETS.maximillion); assert.equal(result.tx.from,owner);
    const decoded=decodeFunctionData({abi:parseAbi(['function repayBehalf(address) payable']),data:result.tx.data});
    assert.deepEqual(decoded.args,[owner]); assert.equal(result.tx.value,'0x2a');
  }
});
test('redeem uses vToken units, not native BNB',()=>{
  const result=buildUnsigned({chainId:56,owner,kind:'REDEEM_AFTER_CLOSE',redeemTokens:789n});
  const decoded=decodeFunctionData({abi:parseAbi(['function redeem(uint256) returns (uint256)']),data:result.tx.data});
  assert.deepEqual(decoded.args,[789n]); assert.equal(result.tx.value,'0x0');
});
test('wrong chain, unknown action, invalid units fail',()=>{
  for(const change of [{chainId:97},{kind:'BORROW'},{amountWei:0n},{amountWei:1},{amountWei:-1n},
    {amountWei:2n**256n},{owner:'0x0000000000000000000000000000000000000000'}]){
    assert.throws(()=>buildUnsigned({chainId:56,owner,kind:'SUPPLY_COLLATERAL',amountWei:1n,...change}));
  }
});
test('RPC cannot broadcast or sign',async()=>{
  for(const method of ['eth_sendRawTransaction','eth_sendTransaction','personal_sign'])
    await assert.rejects(rpc('https://unused.invalid',method),/READ_ONLY_METHOD_REQUIRED/);
});
test('ambiguous amount fields are rejected',()=>{
  assert.throws(()=>buildUnsigned({chainId:56,owner,kind:'SUPPLY_COLLATERAL',amountWei:1n,redeemTokens:1n}));
  assert.throws(()=>buildUnsigned({chainId:56,owner,kind:'ENTER_COLLATERAL_MARKET',amountWei:1n}));
  assert.throws(()=>buildUnsigned({chainId:56,owner,kind:'REDEEM_AFTER_CLOSE',redeemTokens:1n,amountWei:1n}));
});
test('block mismatch and malformed headers cannot attest a snapshot',()=>{
  const header={hash:'0x'+'1'.repeat(64),number:'0x1',timestamp:'0x2'};
  assert.equal(validateHeader(header,'0x1'),header);
  for(const change of [{hash:undefined},{number:'0x2'},{timestamp:'0xzz'}])assert.throws(()=>validateHeader({...header,...change},'0x1'));
  assert.throws(()=>validateHeader(header,'0x20000000000000'));
});
test('redeem error code stops before gas quote',async()=>{
  const draft=buildUnsigned({chainId:56,owner,kind:'REDEEM_AFTER_CLOSE',redeemTokens:1n});
  const calls=[];
  const request=async(_url,method)=>{calls.push(method);return method==='eth_chainId'?'0x38':'0x'+'1'.padStart(64,'0')};
  const result=await simulateUnsigned(draft,{url:'unused',request});
  assert.equal(result.status,'PROTOCOL_ERROR_STOP'); assert.equal(result.gas_estimate,null);
  assert.deepEqual(calls,['eth_chainId','eth_call']);
});
test('override simulation is labelled and has no effect verification',async()=>{
  const draft=buildUnsigned({chainId:56,owner,kind:'SUPPLY_COLLATERAL',amountWei:1n});
  const request=async(_url,method)=>({eth_chainId:'0x38',eth_call:'0x',eth_estimateGas:'0x186a0',eth_gasPrice:'0x2faf080'})[method];
  const result=await simulateUnsigned(draft,{url:'unused',stateOverrides:{},request});
  assert.equal(result.gas_estimate,'100000');assert.equal(result.fee_wei_at_observed_price,'5000000000000');
  assert.equal(result.synthetic_state,true);assert.equal(result.effect_verified,false);assert.equal(result.execution_enabled,false);
});
test('tampered target or calldata cannot receive a maintenance estimate',async()=>{
  const draft=buildUnsigned({chainId:56,owner,kind:'REPAY_BOUNDED',amountWei:1n});
  for(const change of [{to:TARGETS.vbnb},{data:'0x'},{value:'0x0'}])
    await assert.rejects(simulateUnsigned({...draft,tx:{...draft.tx,...change}},{url:'unused'}));
});
test('negative or malformed gas quotes cannot create fee totals',async()=>{
  const draft=buildUnsigned({chainId:56,owner,kind:'SUPPLY_COLLATERAL',amountWei:1n});
  for(const gas of ['-1','123','0x00','0x0']){
    const request=async(_url,method)=>({eth_chainId:'0x38',eth_call:'0x',eth_estimateGas:gas,eth_gasPrice:'0x1'})[method];
    const result=await simulateUnsigned(draft,{url:'unused',request});
    assert.equal(result.status,'SIMULATION_OR_ESTIMATE_STOP');assert.equal(result.gas_estimate,null);
  }
});
