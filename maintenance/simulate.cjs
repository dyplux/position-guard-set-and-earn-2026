/* Latest-state RPC simulation only; state overrides are labelled synthetic. */
const {rpc,quantity} = require('../read_only/rpc.cjs');
const {decodeFunctionResult,parseAbi} = require('../read_only/codec.cjs');
const {validateDraftShape} = require('./unsigned.cjs');
async function simulateUnsigned(draft,{url,stateOverrides,request=rpc}) {
  const tx = validateDraftShape(draft);
  if (quantity(await request(url,'eth_chainId')) !== 56n) throw Error('CHAIN_STOP');
  let signature;
  if (draft.action_kind === 'ENTER_COLLATERAL_MARKET') signature='function enterMarkets(address[]) returns (uint256[])';
  else if(draft.action_kind === 'REDEEM_AFTER_CLOSE') signature='function redeem(uint256) returns (uint256)';
  const params=[tx,'latest'];
  if(stateOverrides!==undefined)params.push(stateOverrides);
  const base={chain_id:56,synthetic_state:stateOverrides!==undefined,execution_enabled:false,
    effect_verified:false,draft_seal_verified:false,gas_estimate:null,protocol_result:null};
  try{
    const result=await request(url,'eth_call',params);
    if(signature){
      const codes=decodeFunctionResult({abi:parseAbi([signature]),functionName:signature.split(' ')[1].split('(')[0],data:result});
      base.protocol_result=codes;
      if(Array.isArray(codes)&&codes.length!==1)throw Error('UNEXPECTED_MARKET_RESULT');
      const failed=Array.isArray(codes)?codes.some(x=>x!==0n):codes!==0n;
      if(failed)return {...base,status:'PROTOCOL_ERROR_STOP'};
    }else if(result!=='0x')throw Error('UNEXPECTED_PROTOCOL_OUTPUT');
    const gasParams=[tx,'latest'];
    if(stateOverrides!==undefined)gasParams.push(stateOverrides);
    const gas=quantity(await request(url,'eth_estimateGas',gasParams));
    const price=quantity(await request(url,'eth_gasPrice'));
    if(gas===0n)throw Error('GAS_ESTIMATE_STOP');
    return {...base,status:'SIMULATED_NOT_AUTHORIZED',gas_estimate:gas.toString(),gas_price_wei:price.toString(),
      fee_wei_at_observed_price:(gas*price).toString(),raw_result:result};
  }catch(e){return {...base,status:'SIMULATION_OR_ESTIMATE_STOP',reason:'RPC_REVERT_OR_UNSUPPORTED_SIMULATION'};}
}
module.exports={simulateUnsigned};
