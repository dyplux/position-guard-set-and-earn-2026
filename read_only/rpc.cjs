/* Read-only JSON-RPC. No wallet, signing, relay or broadcast APIs. */
const crypto = require('node:crypto');
const {encodeFunctionData, decodeFunctionResult, parseAbi} = require('viem');
const METHODS = new Set(['eth_chainId','eth_gasPrice','eth_blockNumber','eth_getBlockByNumber',
  'eth_getCode','eth_getBalance','eth_call','eth_estimateGas','eth_getStorageAt',
  'eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getTransactionCount']);
let sequence = 0;
async function rpc(url, method, params = []) {
  if (!METHODS.has(method)) throw Error('READ_ONLY_METHOD_REQUIRED');
  const id = ++sequence;
  const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}), signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('RPC_HTTP_' + response.status);
  const chunks=[];let total=0;
  for await(const chunk of response.body){
    total+=chunk.length;
    if(total>2_000_000)throw Error('RPC_OVERSIZE');
    chunks.push(Buffer.from(chunk));
  }
  const body=Buffer.concat(chunks).toString('utf8');
  const result = JSON.parse(body);
  if (result.id !== id || result.error || result.result === undefined) throw Error('RPC_RESULT_STOP');
  return result.result;
}
function sha256Code(code) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw Error('CONTRACT_CODE_REQUIRED');
  return crypto.createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');
}
function validateHeader(header,block) {
  if(!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(block)||BigInt(block)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('BLOCK_QUANTITY_STOP');
  if(!header||typeof header.hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(header.hash)
    ||header.number!==block||typeof header.timestamp!=='string'
    ||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(header.timestamp)
    ||BigInt(header.timestamp)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('BLOCK_HEADER_STOP');
  return header;
}
function quantity(value) {
  if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)||value.length>66)throw Error('RPC_QUANTITY_STOP');
  return BigInt(value);
}
async function read(url, address, signature, args = [], block = 'latest') {
  const abi = parseAbi([signature]);
  const functionName = abi[0].name;
  const data = encodeFunctionData({abi,functionName,args});
  const result = await rpc(url, 'eth_call', [{to:address,data},block]);
  return decodeFunctionResult({abi,functionName,data:result});
}
module.exports = {rpc, read, sha256Code, validateHeader, quantity};
