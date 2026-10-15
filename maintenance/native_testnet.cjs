const {encodeFunctionData, parseAbi} = require('../read_only/codec.cjs');

const TARGETS = Object.freeze({
  chainId: 97,
  owner: '0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982',
  vBNB: '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c'
});
const ABI = parseAbi(['function repayBorrow() payable']);
const CHECKS = Object.freeze(['source','runtime','fresh accrued debt','amount<=debt','mandate','gas','reserve','latest simulation','post-state']);
const DRAFT_KEYS = ['action_kind','authority','canonicalUint','chain_id','execution_enabled','preflight_required','required_checks','schema_version','signing_ready','status','tx'];
const TX_KEYS = ['data','from','to','value'];

function exactKeys(value, keys, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(error);
  const own = Reflect.ownKeys(value);
  if (own.some(k => typeof k !== 'string') || own.sort().join(',') !== keys.slice().sort().join(',')
      || own.some(k => { const d = Object.getOwnPropertyDescriptor(value, k); return !d.enumerable || !('value' in d); })) throw Error(error);
}
function buildUnsignedNative(input) {
  exactKeys(input, ['chainId','owner','kind','amountWei'], 'NATIVE_INPUT_SHAPE_REQUIRED');
  if (input.chainId !== TARGETS.chainId) throw Error('TESTNET_CHAIN_REQUIRED');
  if (typeof input.owner !== 'string' || input.owner.toLowerCase() !== TARGETS.owner.toLowerCase()) throw Error('FIXED_OWNER_REQUIRED');
  if (input.kind !== 'REPAY_BOUNDED') throw Error('ACTION_KIND_NOT_ALLOWED');
  if (typeof input.amountWei !== 'bigint' || input.amountWei <= 0n || input.amountWei >= 2n ** 256n) throw Error('POSITIVE_UINT256_REQUIRED');
  return {
    schema_version: 1, status: 'UNSIGNED_TESTNET_CODEC_ONLY', chain_id: 97, action_kind: input.kind,
    authority: 'NONE', execution_enabled: false, signing_ready: false, preflight_required: true,
    required_checks: [...CHECKS], canonicalUint: input.amountWei.toString(),
    tx: {from: TARGETS.owner, to: TARGETS.vBNB, value: `0x${input.amountWei.toString(16)}`,
      data: encodeFunctionData({abi: ABI, functionName: 'repayBorrow'})}
  };
}
function validateNativeDraftShape(draft) {
  exactKeys(draft, DRAFT_KEYS, 'NATIVE_DRAFT_SHAPE_REQUIRED');
  exactKeys(draft.tx, TX_KEYS, 'NATIVE_DRAFT_TX_SHAPE_REQUIRED');
  if (typeof draft.canonicalUint !== 'string' || !/^[1-9][0-9]{0,77}$/.test(draft.canonicalUint)) throw Error('CANONICAL_UINT_REQUIRED');
  const checks = draft.required_checks;
  if (!Array.isArray(checks) || Object.getPrototypeOf(checks) !== Array.prototype
      || checks.length !== CHECKS.length
      || Reflect.ownKeys(checks).some(k => typeof k !== 'string' || (k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k)))
      || Reflect.ownKeys(checks).length !== CHECKS.length + 1
      || CHECKS.some((v, i) => { const d = Object.getOwnPropertyDescriptor(checks, String(i)); return !d || !d.enumerable || !('value' in d) || d.value !== v; })) throw Error('NATIVE_CHECKS_REQUIRED');
  const expected = buildUnsignedNative({chainId: 97, owner: TARGETS.owner, kind: 'REPAY_BOUNDED', amountWei: BigInt(draft.canonicalUint)});
  for (const key of DRAFT_KEYS) {
    if (key === 'tx') continue;
    if (key !== 'required_checks' && draft[key] !== expected[key]) throw Error('NATIVE_DRAFT_BINDING_STOP');
  }
  for (const key of TX_KEYS) if (draft.tx[key] !== expected.tx[key]) throw Error('NATIVE_DRAFT_TX_BINDING_STOP');
  return draft.tx;
}
module.exports = {TARGETS, buildUnsignedNative, validateNativeDraftShape};
