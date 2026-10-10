/* Observational adapter. Pin approval and seller onboarding remain external gates. */
const {rpc, read, sha256Code, validateHeader} = require('../read_only/rpc.cjs');
const {getAddress} = require('../read_only/codec.cjs');
const JOB_SIGNATURE = 'function getJob(uint256) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))';
const STATUS = ['OPEN','FUNDED','SUBMITTED','COMPLETED','REJECTED','EXPIRED'];
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const DEPLOYMENTS = Object.freeze({
  56:{commerce:'0xEa4DAa3100A767e86FDed867729ae7446476EBA6',router:'0x51895229E12F9876011789B04f8698af06cCD6DA',policy:'0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5',paymentToken:'0xcE24439F2D9C6a2289F741120FE202248B666666'},
  97:{commerce:'0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',router:'0xD7d36D66d2F1B608A0F943f722D27e3744f66F25',policy:'0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA',paymentToken:'0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565'}
});
async function inspectDeployment({url,chainId}) {
  const deployment = DEPLOYMENTS[chainId];
  if (!deployment || Number(BigInt(await rpc(url,'eth_chainId'))) !== chainId) throw Error('CHAIN_BINDING_STOP');
  const block = await rpc(url,'eth_blockNumber');
  const header = validateHeader(await rpc(url,'eth_getBlockByNumber',[block,false]),block);
  const pins = {};
  for (const [role,address] of Object.entries(deployment)) {
    pins[role] = {address:getAddress(address), runtime_sha256:sha256Code(await rpc(url,'eth_getCode',[address,block]))};
    const implementationWord = await rpc(url,'eth_getStorageAt',[address,IMPLEMENTATION_SLOT,block]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(implementationWord)) throw Error('IMPLEMENTATION_SLOT_STOP');
    const implementation = '0x'+implementationWord.slice(-40);
    pins[role].eip1967_implementation = implementation;
    if (BigInt(implementation) !== 0n)
      pins[role].implementation_runtime_sha256 = sha256Code(await rpc(url,'eth_getCode',[implementation,block]));
  }
  const token = await read(url,deployment.commerce,'function paymentToken() view returns (address)',[],block);
  if (token.toLowerCase() !== deployment.paymentToken.toLowerCase()) throw Error('PAYMENT_TOKEN_BINDING_STOP');
  const counter = await read(url,deployment.commerce,'function jobCounter() view returns (uint256)',[],block);
  const reconciled = validateHeader(await rpc(url,'eth_getBlockByNumber',[block,false]),block);
  if (reconciled.hash !== header.hash) throw Error('REORG_STOP');
  return {chain_id:chainId,block_tag:block,block_number:Number(BigInt(block)),block_hash:header.hash,
    block_timestamp:Number(BigInt(header.timestamp)),pins,job_counter:counter.toString(),
    deployment_reviewed:false,attested:false,atlas_dispatch_proven:false};
}
async function readJob({url,chainId,jobId}) {
  if (typeof jobId !== 'bigint' || jobId <= 0n || jobId >= 2n**256n) throw Error('JOB_ID_STOP');
  const observation = await inspectDeployment({url,chainId});
  const job = await read(url,DEPLOYMENTS[chainId].commerce,JOB_SIGNATURE,[jobId],observation.block_tag);
  if (job.id !== jobId || !STATUS[job.status]) throw Error('JOB_RESULT_STOP');
  const header = validateHeader(await rpc(url,'eth_getBlockByNumber',[observation.block_tag,false]),observation.block_tag);
  if (header.hash !== observation.block_hash) throw Error('REORG_STOP');
  return {...observation,deployment:DEPLOYMENTS[chainId].commerce,job:{...job,statusName:STATUS[job.status]}};
}
module.exports = {DEPLOYMENTS,JOB_SIGNATURE,inspectDeployment,readJob};
