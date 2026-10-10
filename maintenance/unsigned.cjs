/* Mainnet Core native BNB codec. Encoding doesn't authorize execution. */
const {encodeFunctionData, decodeFunctionData, parseAbi, getAddress} = require('../read_only/codec.cjs');
const TARGETS = Object.freeze({
  comptroller:'0xfD36E2c2a6789Db23113685031d7F16329158384',
  vbnb:'0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  maximillion:'0x5efA1e46F4Fd738FF721F5AebC895b970F13E8A1'
});
function amount(value) {
  if (typeof value !== 'bigint' || value <= 0n || value >= 2n ** 256n) throw Error('POSITIVE_UINT256_REQUIRED');
  return value;
}
function buildUnsigned({chainId, owner, kind, amountWei, redeemTokens}) {
  if (chainId !== 56) throw Error('MAINNET_CHAIN_REQUIRED');
  const from = getAddress(owner);
  if (from === '0x0000000000000000000000000000000000000000') throw Error('OWNER_REQUIRED');
  if(kind==='ENTER_COLLATERAL_MARKET'&&(amountWei!==undefined||redeemTokens!==undefined))throw Error('ENTER_HAS_NO_AMOUNT');
  if(kind==='REDEEM_AFTER_CLOSE'&&amountWei!==undefined)throw Error('REDEEM_REQUIRES_VTOKEN_UNITS');
  if(kind!=='REDEEM_AFTER_CLOSE'&&redeemTokens!==undefined)throw Error('UNEXPECTED_VTOKEN_UNITS');
  let to, signature, args = [], value = 0n;
  switch (kind) {
    case 'SUPPLY_COLLATERAL':
      to = TARGETS.vbnb; signature = 'function mint() payable'; value = amount(amountWei); break;
    case 'ENTER_COLLATERAL_MARKET':
      to = TARGETS.comptroller; signature = 'function enterMarkets(address[]) returns (uint256[])'; args = [[TARGETS.vbnb]]; break;
    case 'REPAY_BOUNDED':
    case 'CLOSE_REMAINING_DEBT':
      to = TARGETS.maximillion; signature = 'function repayBehalf(address) payable'; args = [from]; value = amount(amountWei); break;
    case 'REDEEM_AFTER_CLOSE':
      to = TARGETS.vbnb; signature = 'function redeem(uint256) returns (uint256)'; args = [amount(redeemTokens)]; break;
    default: throw Error('ACTION_KIND_NOT_ALLOWED');
  }
  return {schema_version:1, status:'UNSIGNED_CODEC_ONLY', chain_id:56, action_kind:kind,
    authority:'NONE', execution_enabled:false, preflight_required:true,
    required_checks:['source_and_runtime_seal','fresh_complete_position','oracle_freshness',
      'owner_mandate','amount_and_reserve','latest_simulation','protocol_error_codes','post_state_reconciliation'],
    tx:{from,to,value:'0x'+value.toString(16),data:encodeFunctionData({abi:parseAbi([signature]),functionName:signature.split(' ')[1].split('(')[0],args})}};
}
/* Canonical call shape only. No trusted original transaction or mandate seal. */
function validateDraftShape(draft) {
  if(!draft||draft.chain_id!==56||draft.execution_enabled!==false)throw Error('UNSIGNED_MAINNET_DRAFT_REQUIRED');
  const tx=draft.tx;
  if(!tx||Object.keys(tx).sort().join(',')!=='data,from,to,value'||typeof tx.value!=='string'
    ||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(tx.value))throw Error('DRAFT_TX_STOP');
  const input={chainId:56,owner:tx.from,kind:draft.action_kind};
  if(draft.action_kind==='REDEEM_AFTER_CLOSE'){
    const decoded=decodeFunctionData({abi:parseAbi(['function redeem(uint256) returns (uint256)']),data:tx.data});
    input.redeemTokens=decoded.args[0];
  }else if(draft.action_kind!=='ENTER_COLLATERAL_MARKET')input.amountWei=BigInt(tx.value);
  const expected=buildUnsigned(input).tx;
  for(const field of ['from','to','value','data'])if(typeof tx[field]!=='string'||tx[field].toLowerCase()!==expected[field].toLowerCase())throw Error('DRAFT_CALL_BINDING_STOP');
  return tx;
}
module.exports = {TARGETS, buildUnsigned, validateDraftShape};
