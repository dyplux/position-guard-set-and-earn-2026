'use strict';
/* Positive financial proof fields below are synthetic fixtures, never observations. */
const{test}=require('node:test'),assert=require('node:assert/strict');
const {prepareNative,planLocal,simulateNativeDraft,effectConditions}=require('./maintenance/native_closeout.cjs');
const {observe,F}=require('./maintenance/native_reader.cjs');
const {buildUnsignedNative}=require('./maintenance/native_testnet.cjs');
const v=require('./read_only/codec.cjs'),r=require('./read_only/rpc.cjs');
const pin=r.sha256Code('0x6000');
const mandate={owner:F.owner,borrower:F.owner,chain_id:97,allowed_kinds:['REPAY_BOUNDED'],
  max_value_wei:80,max_gas_wei:20,reserve_wei:30,expires_at:1100,native_market:F.vbnb,units:'wei'};
function mock(options={}){
  let headers=0;
  const calls=[];
  const request=async(url,method,params=[])=>{
    calls.push({url,method,params});
    if(method==='eth_chainId')return options.chain||'0x61';
    if(method==='eth_blockNumber')return options.head||'0x64';
    if(method==='eth_getCode')return options.code||'0x6000';
    if(method==='eth_getBalance')return options.balance||'0xc8';
    if(method==='eth_gasPrice')return options.price||'0x2';
    if(method==='eth_estimateGas')return options.gas||'0x4';
    if(method==='eth_getBlockByNumber')return {number:params[0],hash:'0x'+(options.reorg&&++headers>2?'b':'a').repeat(64),timestamp:'0x3e8'};
    if(method==='eth_call'){
      assert.equal(params.length,2,'no state overrides');
      if(params[0].data==='0x4e4d9fea'){
        if(options.revert)throw Error('MOCK_REVERT');
        return options.output||'0x';
      }
      for(const[signature,args,result]of [
        ['function getAccountSnapshot(address) view returns(uint256,uint256,uint256,uint256)',[F.owner],[0n,1n,options.zero?0n:99n,100n]],
        ['function borrowBalanceCurrent(address) returns(uint256)',[F.owner],options.zero?0n:BigInt(options.debt||100)],
        ['function comptroller() view returns(address)',[],F.controller],
        ['function getAssetsIn(address) view returns(address[])',[F.owner],[F.vbnb]]]){
        const abi=v.parseAbi([signature]),functionName=abi[0].name;
        if(params[0].data===v.encodeFunctionData({abi,functionName,args}))return v.encodeFunctionResult({abi,functionName,result});
      }
    }
    throw Error('UNEXPECTED_MOCK_CALL');
  };
  return {request,calls};
}
async function fixture(){
  const source=mock(),observed=await observe({request:source.request,clock:()=>1000,expectedPin:pin});
  return {...observed,complete_position:true,financial_source_review:true,oracle_freshness:'VERIFIED'};
}
function draft(amountWei=80n){return buildUnsignedNative({chainId:97,owner:F.owner,kind:'REPAY_BOUNDED',amountWei});}
async function simulation(options={}){
  const source=mock(options);
  const result=await simulateNativeDraft(draft(),{state:await fixture(),mandate,now:1000,request:source.request,expectedPin:pin});
  return {...source,result};
}
test('synthetic reader->mandate->need->codec->twoRPC simulation with honest effect limits',async()=>{
  const x=await simulation();
  assert.equal(x.result.status,'SIMULATED_EFFECT_UNVERIFIED',x.result.reason);
  assert.equal(x.result.synthetic,true);assert.equal(x.result.effect_verified,false);
  assert.equal(x.result.signer_status,'NO_SIGNER');assert.equal(x.result.execution_enabled,false);
  assert.equal(x.result.max_observed_fee_wei,'8');assert.equal(x.result.providers.length,2);
  assert.equal(x.result.expected_effect.debt_after_at_same_block_wei,'20');
  assert.equal(x.result.state_overrides_used,false);
  assert.equal(x.calls.filter(x=>x.method==='eth_call'&&x.params[0].data===draft().tx.data).length,2);
  assert.ok(x.calls.every(x=>!x.method.includes('send')&&!x.method.includes('sign')));
});
test('zero debt produces no unsigned proposal, call or hash',async()=>{
  const source=mock({zero:true}),x=await prepareNative({request:source.request,clock:()=>1000,expectedPin:pin});
  assert.equal(x.status,'NO_ACTION');assert.equal(x.unsigned_proposal,null);assert.equal(x.unsigned_proposal_sha256,null);
  assert.equal(x.real_actions,0);assert.equal(x.signer_status,'NO_SIGNER');
  assert.ok(source.calls.every(x=>x.method!=='eth_estimateGas'));
});
test('honest synthetic reader debt stops at incomplete position',async()=>{
  const source=mock(),x=await prepareNative({request:source.request,clock:()=>1000,expectedPin:pin,mandate});
  assert.equal(x.status,'STOP');assert.equal(x.plan.reason,'INCOMPLETE_POSITION');
  assert.equal(x.unsigned_proposal,null);
});
test('changed block/debt/balance/runtime/chain/reorg/gas and protocol output stop',async()=>{
  for(const [changes,reason] of [[{head:'0x65'},'FRESH_COMMON_BLOCK_CHANGED'],
    [{debt:101},'FRESH_VALUE_BINDING_STOP'],[{balance:'0xc7'},'FRESH_VALUE_BINDING_STOP'],
    [{code:'0x6001'},'CHAIN_OR_RUNTIME_STOP'],[{chain:'0x38'},'CHAIN_OR_RUNTIME_STOP'],
    [{reorg:true},'REORG_STOP'],[{gas:'0xb'},'GAS_OR_RESERVE_STOP'],
    [{price:'0x0'},'GAS_OR_RESERVE_STOP'],[{output:'0x00'},'NATIVE_PROTOCOL_OUTPUT_STOP'],
    [{revert:true},'MOCK_REVERT']]){
    const x=await simulation(changes);assert.equal(x.result.status,'SIMULATION_STOP',JSON.stringify(changes));
    assert.equal(x.result.reason,reason);
  }
});
test('draft amount and unsigned metadata cannot bypass policy',async()=>{
  const state=await fixture(),source=mock();
  await assert.rejects(()=>simulateNativeDraft(draft(81n),{state,mandate,now:1000,request:source.request,expectedPin:pin}));
  await assert.rejects(()=>simulateNativeDraft({...draft(),execution_enabled:true},{state,mandate,now:1000,request:source.request}));
  assert.equal(source.calls.length,0);
});
test('invalid missing mandate and asserted source/oracle booleans stop',async()=>{
  const state=await fixture();
  for(const changes of [{max_value_wei:'080'},{max_gas_wei:NaN},{reserve_wei:-1},{expires_at:1000},{max_value_wei:2**53}])
    assert.equal(planLocal(state,{...mandate,...changes},1000).status,'STOP');
  assert.equal(planLocal(state,null,1000).status,'STOP');
  for(const changes of [{complete_position:'true'},{financial_source_review:1},{oracle_freshness:'UNKNOWN'}])
    assert.equal(planLocal({...state,...changes},mandate,1000).status,'STOP');
});
test('synthetic and production boundaries reject unverifiable state and pin replacement',async()=>{
  const state=await fixture();
  await assert.rejects(()=>simulateNativeDraft(draft(),{state:{...state,kind:'OBSERVED'},mandate,now:1000,request:mock().request,expectedPin:pin}));
  await assert.rejects(()=>simulateNativeDraft(draft(),{expectedPin:pin}));
});
test('counterfactual effects conserve reserve and stay unverified',async()=>{
  const state=await fixture(),plan=planLocal(state,mandate,1000),effect=effectConditions(state,plan);
  assert.equal(effect.reserve_after_value_and_max_gas_wei,'100');assert.equal(effect.minimum_reserve_wei,'30');
  assert.equal(effect.effect_verified,false);
});

test('exact decimal monetary mandate handles actual measured balance and 0.01BNB reserve',async()=>{
  const balance='17940492450000000',debt='1000000000000000';
  const wire={...mandate,max_value_wei:'500000000000000',max_gas_wei:'200000000000000',reserve_wei:'10000000000000000'};
  const source=mock({balance:'0x'+BigInt(balance).toString(16),debt});
  const observed=await observe({request:source.request,clock:()=>1000,expectedPin:pin});
  const state={...observed,complete_position:true,financial_source_review:true,oracle_freshness:'VERIFIED'};
  const plan=planLocal(state,wire,1000);
  assert.equal(plan.status,'UNSIGNED_PROPOSAL');assert.equal(plan.amount_wei,'500000000000000');
  assert.equal(plan.reserve_wei,'10000000000000000');
  assert.equal(effectConditions(state,plan).reserve_after_value_and_max_gas_wei,'17240492450000000');
  const canonical=draft(BigInt(plan.amount_wei));
  const result=await simulateNativeDraft(canonical,{state,mandate:wire,now:1000,request:source.request,expectedPin:pin});
  assert.equal(result.status,'SIMULATED_EFFECT_UNVERIFIED');assert.equal(result.effect_verified,false);
  for(const key of ['max_value_wei','max_gas_wei','reserve_wei']){
    assert.equal(planLocal(state,{...wire,[key]:10000000000000000},1000).status,'STOP');
    for(const value of ['01','1e16','+1','-1','1.0','', '1'.repeat(79), (2n**256n).toString(),true,NaN])
      assert.equal(planLocal(state,{...wire,[key]:value},1000).status,'STOP');
  }
});
