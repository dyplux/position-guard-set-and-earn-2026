const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TARGETS, buildUnsignedNative, validateNativeDraftShape} = require('./maintenance/native_testnet.cjs');
const {decodeFunctionData, parseAbi} = require('./read_only/codec.cjs');

const input = {chainId:97, owner:TARGETS.owner, kind:'REPAY_BOUNDED', amountWei:42n};
test('builds the fixed testnet repay calldata', () => {
  const draft = buildUnsignedNative(input);
  assert.equal(draft.status, 'UNSIGNED_TESTNET_CODEC_ONLY');
  assert.equal(draft.authority, 'NONE'); assert.equal(draft.execution_enabled, false); assert.equal(draft.signing_ready, false);
  assert.equal(draft.tx.from, TARGETS.owner); assert.equal(draft.tx.to, TARGETS.vBNB); assert.equal(draft.tx.value, '0x2a');
  assert.equal(decodeFunctionData({abi:parseAbi(['function repayBorrow() payable']), data:draft.tx.data}).args, undefined);
});
test('accepts only the exact positive uint256 input shape', () => {
  assert.equal(buildUnsignedNative({...input, amountWei:2n ** 256n - 1n}).canonicalUint, (2n ** 256n - 1n).toString());
  for (const change of [{chainId:56},{owner:'0x1111111111111111111111111111111111111111'},{kind:'BORROW'},{amountWei:0n},{amountWei:1},{amountWei:2n ** 256n},{extra:true}]) assert.throws(() => buildUnsignedNative({...input, ...change}));
});
test('rejects foreign owners and does not mutate input', () => {
  const copy = {...input}; buildUnsignedNative(copy); assert.deepEqual(copy, input);
  assert.throws(() => buildUnsignedNative({...input, owner:'0xF9Ad22cAA6C179Eee86806FA10176e845ea8e983'}));
});
test('validates the complete canonical draft', () => {
  const draft = buildUnsignedNative(input); assert.deepEqual(validateNativeDraftShape(draft), draft.tx);
  for (const change of [{canonicalUint:'043'},{status:'UNSIGNED_CODEC_ONLY'},{tx:{...draft.tx,value:'0x2b'}},{extra:true}]) assert.throws(() => validateNativeDraftShape({...draft, ...change}));
  assert.throws(() => validateNativeDraftShape({...draft, tx:{...draft.tx,data:'0x'}}));
});
test('exposes the required preflight gates and no execution authority', () => {
  const draft = buildUnsignedNative(input);
  assert.deepEqual(draft.required_checks, ['source','runtime','fresh accrued debt','amount<=debt','mandate','gas','reserve','latest simulation','post-state']);
  assert.equal(draft.preflight_required, true); assert.equal(draft.signing_ready, false);
});
test('rejects noncanonical JavaScript shapes and excessive decimal input', () => {
  for (const candidate of [Object.assign({...input}, {[Symbol('extra')]:true}),
    Object.defineProperty({...input}, 'hidden', {value:true}),
    Object.defineProperty({...input}, 'owner', {get:()=>TARGETS.owner})])
    assert.throws(() => buildUnsignedNative(candidate));
  const draft = buildUnsignedNative(input);
  assert.throws(() => validateNativeDraftShape({...draft, canonicalUint:'1'.repeat(10000)}));
  assert.throws(() => validateNativeDraftShape({...draft, required_checks:{toJSON:()=>draft.required_checks}}));
  const extra = [...draft.required_checks]; extra.metadata = true;
  assert.throws(() => validateNativeDraftShape({...draft, required_checks:extra}));
  const accessor = [...draft.required_checks];
  Object.defineProperty(accessor, '0', {get:()=>draft.required_checks[0]});
  assert.throws(() => validateNativeDraftShape({...draft, required_checks:accessor}));
});
