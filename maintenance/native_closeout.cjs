'use strict';
/* Read -> unsigned policy -> bounded codec -> quorum simulation. No signer APIs. */
const crypto=require('node:crypto'),path=require('node:path'),{execFileSync}=require('node:child_process');
const r=require('../read_only/rpc.cjs'),v=require('../read_only/codec.cjs');
const {observe,F,URLS}=require('./native_reader.cjs');
const {buildUnsignedNative,validateNativeDraftShape}=require('./native_testnet.cjs');
const ROOT=path.resolve(__dirname,'..');
const noAuthority={authority:'NONE',execution_enabled:false,signing_ready:false,financial_ready:false,signer_status:'NO_SIGNER'};
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function planLocal(state,mandate,now){
  // Monetary wire fields are canonical decimal strings. Safe integer callers remain compatible.
  let wireMandate=mandate;
  if(mandate!==null){
    if(!mandate||typeof mandate!=='object'||Array.isArray(mandate)
      ||['chain_id','expires_at'].some(k=>!Number.isSafeInteger(mandate[k])||mandate[k]<0))
      return {status:'STOP',action:null,reason:'LOSSLESS_MANDATE_REQUIRED',...noAuthority};
    wireMandate={...mandate};
    for(const key of ['max_value_wei','max_gas_wei','reserve_wei']){
      const value=mandate[key];
      if(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n)
        wireMandate[key]=value;
      else if(Number.isSafeInteger(value)&&value>=0)wireMandate[key]=value.toString();
      else return {status:'STOP',action:null,reason:'CANONICAL_MONETARY_WIRE_REQUIRED',...noAuthority};
    }
  }
  const input=JSON.stringify({state,mandate:wireMandate,now});
  if(input.length>100000)throw Error('POLICY_INPUT_SIZE_STOP');
  return JSON.parse(execFileSync('/usr/bin/python3',['-m','maintenance.planner'],
    {cwd:ROOT,input,encoding:'utf8',timeout:10000,maxBuffer:100000,env:{PATH:'/usr/bin:/bin'}}));
}
function effectConditions(state,plan){
  return {type:'COUNTERFACTUAL_EXPECTATION_ONLY',debt_before_wei:state.current_accrued_debt_raw,
    repayment_wei:plan.amount_wei,debt_after_at_same_block_wei:plan.expected_debt_after_wei,
    reserve_after_value_and_max_gas_wei:(BigInt(state.native_balance_wei)-BigInt(plan.amount_wei)-BigInt(plan.gas_budget_wei)).toString(),
    minimum_reserve_wei:plan.reserve_wei,effect_verified:false,
    reason:'ETH_CALL_DOES_NOT_EXPOSE_POST_STATE_OR_CREATE_RECEIPT'};
}
async function simulateNativeDraft(draft,{state,mandate,now,request=r.rpc,expectedPin=F.pin}={}){
  const tx=validateNativeDraftShape(draft);
  if(!/^[a-f0-9]{64}$/.test(expectedPin)||(request===r.rpc&&expectedPin!==F.pin))throw Error('PRODUCTION_PIN_STOP');
  // Production accepts only a new observation, never a caller-supplied financial state.
  if(request===r.rpc){state=await observe();now=Math.floor(Date.now()/1000);}
  else if(!state||state.kind!=='SYNTHETIC')throw Error('SYNTHETIC_REQUEST_REQUIRES_SYNTHETIC_STATE');
  const plan=planLocal(state,mandate,now);
  if(plan.status!=='UNSIGNED_PROPOSAL')return {status:'POLICY_STOP',reason:plan.reason,...noAuthority,effect_verified:false};
  const canonical=buildUnsignedNative({chainId:97,owner:F.owner,kind:'REPAY_BOUNDED',amountWei:BigInt(plan.amount_wei)});
  if(digest(canonical)!==digest(draft))throw Error('DRAFT_POLICY_BINDING_STOP');
  const block='0x'+BigInt(state.block_number).toString(16),base={...noAuthority,
    synthetic:request!==r.rpc,draft_sha256:digest(draft),effect_verified:false,
    expected_effect:effectConditions(state,plan),state_overrides_used:false};
  try{
    const heads=await Promise.all(URLS.map(url=>request(url,'eth_blockNumber')));
    const common=heads.map(r.quantity).reduce((a,b)=>a<b?a:b);
    if(common!==BigInt(state.block_number))throw Error('FRESH_COMMON_BLOCK_CHANGED');
    const rows=await Promise.all(URLS.map(async url=>{
      const q=(method,params=[])=>request(url,method,params);
      if(r.quantity(await q('eth_chainId'))!==97n||r.sha256Code(await q('eth_getCode',[F.vbnb,block]))!==expectedPin)throw Error('CHAIN_OR_RUNTIME_STOP');
      const header=r.validateHeader(await q('eth_getBlockByNumber',[block,false]),block);
      if(header.hash!==state.block_hash||Number(r.quantity(header.timestamp))!==state.block_timestamp)throw Error('OBSERVATION_HEADER_STOP');
      const abi=v.parseAbi(['function borrowBalanceCurrent(address) returns(uint256)']);
      const debt=v.decodeFunctionResult({abi,functionName:'borrowBalanceCurrent',data:await q('eth_call',
        [{to:F.vbnb,data:v.encodeFunctionData({abi,functionName:'borrowBalanceCurrent',args:[F.owner]})},block])});
      const balance=r.quantity(await q('eth_getBalance',[F.owner,block]));
      if(debt!==BigInt(state.current_accrued_debt_raw)||balance!==BigInt(state.native_balance_wei)||BigInt(draft.canonicalUint)>debt)throw Error('FRESH_VALUE_BINDING_STOP');
      const result=await q('eth_call',[tx,block]);
      if(result!=='0x')throw Error('NATIVE_PROTOCOL_OUTPUT_STOP');
      const gas=r.quantity(await q('eth_estimateGas',[tx,block])),price=r.quantity(await q('eth_gasPrice'));
      if(gas===0n||price===0n||gas*price>BigInt(plan.gas_budget_wei)
        ||balance-BigInt(draft.canonicalUint)-gas*price<BigInt(plan.reserve_wei))throw Error('GAS_OR_RESERVE_STOP');
      const end=r.validateHeader(await q('eth_getBlockByNumber',[block,false]),block);
      if(end.hash!==header.hash||end.timestamp!==header.timestamp)throw Error('REORG_STOP');
      return {rpc:url,block_hash:header.hash,raw_result:result,gas_estimate:gas.toString(),gas_price_wei:price.toString(),fee_wei:(gas*price).toString()};
    }));
    if(rows[0].raw_result!==rows[1].raw_result||rows[0].block_hash!==rows[1].block_hash)throw Error('SIMULATION_QUORUM_STOP');
    const finished=request===r.rpc?Math.floor(Date.now()/1000):now;
    if(!Number.isSafeInteger(finished)||finished<state.block_timestamp||finished-state.block_timestamp>120
      ||finished>=mandate.expires_at)throw Error('FINAL_FRESHNESS_OR_EXPIRY_STOP');
    const maxFee=rows.map(x=>BigInt(x.fee_wei)).reduce((a,b)=>a>b?a:b);
    return {...base,status:'SIMULATED_EFFECT_UNVERIFIED',block_number:state.block_number,
      max_observed_fee_wei:maxFee.toString(),providers:rows,reason:'NO_RECEIPT_OR_POST_STATE_PROOF'};
  }catch(error){return {...base,status:'SIMULATION_STOP',reason:error.message};}
}
async function prepareNative({mandate=null,request=r.rpc,clock,expectedPin}={}){
  const state=await observe({request,...(clock?{clock}:{}),...(expectedPin?{expectedPin}:{})});
  const now=clock?clock():Math.floor(Date.now()/1000),plan=planLocal(state,mandate,now);
  const base={status:plan.status,...noAuthority,state,plan,unsigned_proposal:null,unsigned_proposal_sha256:null,
    simulation:null,effect_verified:false,real_actions:0};
  if(plan.status!=='UNSIGNED_PROPOSAL')return base;
  const draft=buildUnsignedNative({chainId:97,owner:F.owner,kind:'REPAY_BOUNDED',amountWei:BigInt(plan.amount_wei)});
  const simulation=await simulateNativeDraft(draft,{state,mandate,now,request});
  return {...base,status:simulation.status,unsigned_proposal:draft,unsigned_proposal_sha256:digest(draft),simulation};
}
module.exports={prepareNative,planLocal,simulateNativeDraft,effectConditions};
if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--read'){
    console.log(JSON.stringify({status:'NO_EXECUTION',...noAuthority}));
  }else prepareNative().then(x=>console.log(JSON.stringify(x))).catch(e=>{
    console.log(JSON.stringify({status:'READ_STOP',reason:e.message,...noAuthority}));process.exitCode=1;
  });
}
