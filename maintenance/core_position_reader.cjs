'use strict';
/* Fixed Core observation only. No financial planner or signer imports. */
const r=require('../read_only/rpc.cjs'),v=require('../read_only/codec.cjs');
const {F,URLS}=require('./native_reader.cjs');
const ALLOWED=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call']);
const CONCURRENCY=8,MAX_MARKETS=64,MAX_SECONDS=30;
const CORE=Object.freeze({vai:'0xf70C3C6b749BbAb89C081737334E74C9aFD4BE16',
 native:'0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',mainAdapter:'0xCeA29f1266e880A1482c06eD656cD08C148BaA32'});
// Getter compatibility only: exact deployed proxy profiles and implementation runtime.
const LEGACY=Object.freeze({implementation:'0x73fF75092Da265b87b25ffB943c47C90419a04A6',
 implementation_pin:'2359bce83d9f956f4e31177d0433d561d97e4ff571b0fa13f864e66f828100da',
 proxies:Object.freeze({
  "0xd5c4c2e2facbeb59d0216d0595d63fcdc6f9a1a7": "254250e06d9c54ecf2e1a67fc1d0a0f935dbd8a1c3c75206a96115820b6e9789",
  "0xb7526572ffe56ab9d7489838bf2e18e3323b441a": "254250e06d9c54ecf2e1a67fc1d0a0f935dbd8a1c3c75206a96115820b6e9789",
  "0x08e0a5575de71037ae36abfafb516595fe68e5e4": "254250e06d9c54ecf2e1a67fc1d0a0f935dbd8a1c3c75206a96115820b6e9789",
  "0x74469281310195a04840daf6edf576f559a3de80": "254250e06d9c54ecf2e1a67fc1d0a0f935dbd8a1c3c75206a96115820b6e9789",
  "0x6d6f697e34145bb95c54e77482d97cc261dc237e": "b38a83a4a6e3cb65ff3376672649c9a41c581fdc98cffd5edbb52fb580ce8309",
  "0x162d005f0fff510e54958cfc5cf32a3180a84aab": "b185f572e006609fac6569bdc1dfca403596c622e4c0ce94179abe47a33bc9cf",
  "0xafc13bc065abee838540823431055d2ea52eba52": "b185f572e006609fac6569bdc1dfca403596c622e4c0ce94179abe47a33bc9cf",
  "0x488ab2826a154da01cc4cc16a8c83d4720d3ca2c": "b185f572e006609fac6569bdc1dfca403596c622e4c0ce94179abe47a33bc9cf",
  "0xb6e9322c49fd75a367fcb17b0fcd62c5070ebcbe": "b185f572e006609fac6569bdc1dfca403596c622e4c0ce94179abe47a33bc9cf",
  "0x37c28de42ba3d22217995d146fc684b2326ede64": "ce2e7a5216fde5879afad5f9f3cc27a5f1c42500564964beb5671d43871fde48"
})});
const systemClock=()=>Math.floor(Date.now()/1000),stable=x=>JSON.stringify(x);
let rpcSequence=0;
function strictJson(text){
 const value=JSON.parse(text,(_,item)=>{
  if(typeof item==='number'&&!Number.isFinite(item))throw Error('RPC_NONFINITE_JSON_STOP');return item;
 });
 // JSON syntax is already validated. Track object keys before duplicate values can disappear.
 const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)||[];
 const stack=[];
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(token==='{')stack.push(new Set());
  else if(token==='[')stack.push(null);
  else if(token==='}'||token===']')stack.pop();
  else if(token[0]==='"'&&tokens[i+1]===':'){
   const key=JSON.parse(token),keys=stack[stack.length-1];
   if(!(keys instanceof Set)||keys.has(key))throw Error('RPC_DUPLICATE_JSON_STOP');keys.add(key);
  }
 }
 return value;
}
async function coreRpc(url,method,params,deadline){
 if(!URLS.includes(url)||!ALLOWED.has(method))throw Error('READ_ONLY_TRANSPORT_STOP');
 const remaining=Math.floor(deadline-performance.now());if(remaining<=0)throw Error('DEADLINE_STOP');
 const id=++rpcSequence,response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(Math.min(15000,remaining))});
 if(response.redirected)throw Error('RPC_REDIRECT_STOP');
 if(!response.ok)throw Error('RPC_HTTP_'+response.status);
 const chunks=[];let size=0;for await(const part of response.body){size+=part.length;if(size>2000000)throw Error('RPC_OVERSIZE');chunks.push(Buffer.from(part));}
 const body=strictJson(Buffer.concat(chunks).toString('utf8'));
 if(!body||typeof body!=='object'||Array.isArray(body)||body.jsonrpc!=='2.0'||body.id!==id
  ||Object.hasOwn(body,'error')||!Object.hasOwn(body,'result'))throw Error('RPC_RESULT_STOP');
 return body.result;
}
const safety={authority:'NONE',signer_status:'NO_SIGNER',execution_enabled:false,signing_ready:false,
 financial_ready:false,financial_source_review:false,complete_position:false,real_actions:0};
function address(value){
 if(typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw Error('ADDRESS_STOP');
 return v.getAddress(value);
}
function marketList(value,allowEmpty=false){
 if(!Array.isArray(value)||value.length>MAX_MARKETS||(!allowEmpty&&value.length===0))throw Error('MARKET_LIST_STOP');
 const out=value.map(address);
 if(new Set(out.map(x=>x.toLowerCase())).size!==out.length)throw Error('MARKET_LIST_STOP');
 return out;
}
function uint(value){if(typeof value!=='bigint'||value<0n||value>=2n**256n)throw Error('UINT256_STOP');return value;}
function safeTime(value){if(!Number.isSafeInteger(value)||value<0)throw Error('CLOCK_STOP');return value;}
async function mapLimit(items,limit,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}
 }));return out;
}
function decode(signature,data){
 if(typeof data!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(data)||data.length>50000)throw Error('ABI_WIRE_STOP');
 const abi=v.parseAbi([signature]),functionName=abi[0].name;
 const value=v.decodeFunctionResult({abi,functionName,data});
 if(v.encodeFunctionResult({abi,functionName,result:value}).toLowerCase()!==data.toLowerCase())throw Error('NONCANONICAL_ABI_STOP');
 return value;
}
async function observeCore(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['request','clock','expectedPin'].includes(k)))throw Error('OPTIONS_STOP');
 const {request=r.rpc,clock=systemClock,expectedPin=F.pin}=options;
 if(typeof request!=='function'||typeof clock!=='function'||typeof expectedPin!=='string'||!/^[a-f0-9]{64}$/.test(expectedPin)
  ||request===r.rpc&&expectedPin!==F.pin)throw Error('DEPENDENCIES_OR_PRODUCTION_PIN_STOP');
 const initial=safeTime(clock()),wallStart=performance.now(),deadline=wallStart+MAX_SECONDS*1000;
 const costs={rpc_calls:0,eth_calls:0,elapsed_ms:null,concurrency_per_provider:CONCURRENCY,max_markets:MAX_MARKETS,deadline_seconds:MAX_SECONDS};
 const q=async(url,method,params=[])=>{
  if(!ALLOWED.has(method))throw Error('READ_ONLY_METHOD_STOP');
  if(performance.now()>deadline||safeTime(clock())-initial>MAX_SECONDS)throw Error('DEADLINE_STOP');
  costs.rpc_calls++;if(method==='eth_call')costs.eth_calls++;
  const result=await (request===r.rpc?coreRpc(url,method,params,deadline):request(url,method,params));
  if(performance.now()>deadline||safeTime(clock())-initial>MAX_SECONDS)throw Error('DEADLINE_STOP');
  return result;
 };
 let block=null;
 try{
  const heads=await Promise.all(URLS.map(url=>q(url,'eth_blockNumber'))),height=heads.map(r.quantity).reduce((a,b)=>a<b?a:b);
  if(height>BigInt(Number.MAX_SAFE_INTEGER))throw Error('BLOCK_STOP');block='0x'+height.toString(16);
  const providerResults=await Promise.allSettled(URLS.map(async url=>{
   const header=r.validateHeader(await q(url,'eth_getBlockByNumber',[block,false]),block);
   if(r.quantity(await q(url,'eth_chainId'))!==97n)throw Error('CHAIN_STOP');
   const controllerHash=r.sha256Code(await q(url,'eth_getCode',[F.controller,block]));
   async function read(to,signature,args=[]){const abi=v.parseAbi([signature]),functionName=abi[0].name;
    let raw;
    try{raw=await q(url,'eth_call',[{to,data:v.encodeFunctionData({abi,functionName,args})},block]);return decode(signature,raw);}
    catch(error){const failure=Error(functionName+':'+error.message);
     if(typeof raw==='string'&&raw.length<=514)failure.raw_return=raw;throw failure;}}
   const markets=marketList(await read(F.controller,'function getAllMarkets() view returns(address[])'));
   if(!markets.some(x=>x.toLowerCase()===F.vbnb.toLowerCase()))throw Error('NATIVE_MARKET_MISSING');
   const entered=marketList(await read(F.controller,'function getAssetsIn(address) view returns(address[])',[F.owner]),true);
   if(entered.some(x=>!markets.some(m=>m.toLowerCase()===x.toLowerCase())))throw Error('ENTERED_SCOPE_STOP');
   let legacyImplementationProof;
   const ledger=await mapLimit(markets,CONCURRENCY,async market=>{
    const base={market,unit:market.toLowerCase()===F.vbnb.toLowerCase()?'NATIVE_WEI':'UNDERLYING_RAW_OF_MARKET',
     status:'UNKNOWN',vtoken_balance_raw:null,stored_borrow_raw:null,current_accrued_debt_raw:null,exchange_rate_raw:null,runtime_sha256:null};
    try{
     const codeHash=r.sha256Code(await q(url,'eth_getCode',[market,block]));
     if(market.toLowerCase()===F.vbnb.toLowerCase()&&codeHash!==expectedPin)throw Error('NATIVE_RUNTIME_STOP');
     const controller=address(await read(market,'function comptroller() view returns(address)'));
     if(controller.toLowerCase()!==F.controller.toLowerCase())throw Error('MARKET_CONTROLLER_STOP');
     base.runtime_sha256=codeHash;
     const snapshotSignature='function getAccountSnapshot(address) view returns(uint256,uint256,uint256,uint256)';
     const legacyPin=LEGACY.proxies[market.toLowerCase()];
     if(legacyPin){
      if(codeHash!==legacyPin)throw Error('LEGACY_PROXY_RUNTIME_STOP');
      const implementation=address(await read(market,'function implementation() view returns(address)'));
      if(implementation!==LEGACY.implementation)throw Error('LEGACY_IMPLEMENTATION_BINDING_STOP');
      if(!legacyImplementationProof)legacyImplementationProof=q(url,'eth_getCode',[implementation,block]).then(code=>{
       if(r.sha256Code(code)!==LEGACY.implementation_pin)throw Error('LEGACY_IMPLEMENTATION_RUNTIME_STOP');return true;
      });
      await legacyImplementationProof;
     }
     let snapshot,debt,snapshotError,debtError;
     try{
      if(legacyPin){
       const abi=v.parseAbi([snapshotSignature]),data=v.encodeFunctionData({abi,functionName:'getAccountSnapshot',args:[F.owner]});
       const inner=await read(market,'function delegateToViewImplementation(bytes) view returns(bytes)',[data]);
       snapshot=decode(snapshotSignature,inner); // Full canonical outer bytes and inner 128-byte tuple, never a prefix.
      }else snapshot=await read(market,snapshotSignature,[F.owner]);
     }catch(error){snapshotError=error;}
     // Attempt the independent accrued getter even when the snapshot ABI is unsupported.
     try{debt=uint(await read(market,'function borrowBalanceCurrent(address) returns(uint256)',[F.owner]));}
     catch(error){debtError=error;}
     if(snapshotError||debtError)return {...base,reason:(snapshotError||debtError).message,
      read_observations:{snapshot_status:snapshotError?'UNKNOWN':'OBSERVED_ABI_ONLY',snapshot_raw_return:snapshotError?.raw_return||null,
       accrued_getter_status:debtError?'UNKNOWN':'OBSERVED',accrued_getter_raw:debtError?null:debt.toString()}};
     if(!Array.isArray(snapshot)||snapshot.length!==4||snapshot.some(n=>{uint(n);return false;})||snapshot[0]!==0n||snapshot[3]===0n)throw Error('MARKET_SNAPSHOT_STOP');
     if(debt<snapshot[2])throw Error('ACCRUED_DEBT_STOP');
     return {...base,status:'OBSERVED',snapshot_source:legacyPin?'LEGACY_CANONICAL_INNER_4UINT':'EXTERNAL_CANONICAL_4UINT',runtime_sha256:codeHash,vtoken_balance_raw:snapshot[1].toString(),stored_borrow_raw:snapshot[2].toString(),current_accrued_debt_raw:debt.toString(),exchange_rate_raw:snapshot[3].toString()};
    }catch(error){return {...base,reason:error.message};}
   });
   let vai={status:'UNKNOWN',controller:null,unit:'VAI_RAW',minted_vai_raw:null,repay_amount_raw:null,
    accrual_semantics:'STORED_VAI_MINT_INDEX_GETTER',current_accrual_verified:false};
   try{
    const controller=address(await read(F.controller,'function vaiController() view returns(address)'));
    if(controller.toLowerCase()!==CORE.vai.toLowerCase())throw Error('VAI_CONTROLLER_SCOPE_STOP');
    const codeHash=r.sha256Code(await q(url,'eth_getCode',[controller,block]));
    if(address(await read(controller,'function comptroller() view returns(address)')).toLowerCase()!==F.controller.toLowerCase())throw Error('VAI_CORE_BINDING_STOP');
    const minted=uint(await read(F.controller,'function mintedVAIs(address) view returns(uint256)',[F.owner]));
    const repay=uint(await read(controller,'function getVAIRepayAmount(address) view returns(uint256)',[F.owner]));
    if(repay<minted)throw Error('VAI_REPAY_AMOUNT_STOP');
    vai={...vai,status:'OBSERVED',controller,runtime_sha256:codeHash,minted_vai_raw:minted.toString(),repay_amount_raw:repay.toString()};
   }catch(error){vai={...vai,reason:error.message};}
   let oracle={status:'UNKNOWN',price_source_mode:'UNKNOWN',freshness:'UNKNOWN',effective_price_updated_at:null};
   try{
    const oracleAddress=address(await read(F.controller,'function oracle() view returns(address)'));
    const oracleHash=r.sha256Code(await q(url,'eth_getCode',[oracleAddress,block]));
    if(address(await read(oracleAddress,'function nativeMarket() view returns(address)')).toLowerCase()!==F.vbnb.toLowerCase())throw Error('ORACLE_NATIVE_MARKET_STOP');
    const paused=await read(oracleAddress,'function paused() view returns(bool)');if(typeof paused!=='boolean'||paused)throw Error('ORACLE_PAUSED_STOP');
    const config=await read(oracleAddress,'function getTokenConfig(address) view returns(address,address[3],bool[3],bool)',[CORE.native]);
    if(!Array.isArray(config)||config.length!==4||address(config[0]).toLowerCase()!==CORE.native.toLowerCase()
     ||!Array.isArray(config[1])||config[1].length!==3||!Array.isArray(config[2])||config[2].length!==3
     ||config[2].some(x=>typeof x!=='boolean')||typeof config[3]!=='boolean')throw Error('ORACLE_CONFIG_STOP');
    const [main,enabled]=await read(oracleAddress,'function getOracle(address,uint8) view returns(address,bool)',[CORE.native,0]);
    if(!enabled||!config[2][0]||address(main)!==address(config[1][0])||main.toLowerCase()!==CORE.mainAdapter.toLowerCase()
     ||config[2][1]||config[2][2])throw Error('ORACLE_SOURCE_PATH_STOP');
    const adapterHash=r.sha256Code(await q(url,'eth_getCode',[main,block]));
    const direct=uint(await read(main,'function prices(address) view returns(uint256)',[CORE.native]));
    const price=uint(await read(oracleAddress,'function getUnderlyingPrice(address) view returns(uint256)',[F.vbnb]));
    if(price===0n||direct>0n&&price!==direct)throw Error('ORACLE_PRICE_BINDING_STOP');
    const tokenConfig=await read(main,'function tokenConfigs(address) view returns(address,address,uint256)',[CORE.native]);
    if(address(tokenConfig[0]).toLowerCase()!==CORE.native.toLowerCase()||uint(tokenConfig[2])===0n)throw Error('FEED_CONFIG_STOP');
    const feed=address(tokenConfig[1]);
    oracle={...oracle,status:'OBSERVED',address:oracleAddress,runtime_sha256:oracleHash,main_adapter:main,main_adapter_runtime_sha256:adapterHash,
     main_enabled:true,pivot_enabled:false,fallback_enabled:false,caching_enabled:config[3],native_price_raw:price.toString(),
     direct_override_price_raw:direct.toString(),configured_feed:feed,max_stale_period_seconds:tokenConfig[2].toString(),
     price_source_mode:direct>0n?'DIRECT_OVERRIDE_WITHOUT_TIMESTAMP':'FEED_PATH_OBSERVED_FRESHNESS_UNKNOWN'};
    if(direct===0n){
     r.sha256Code(await q(url,'eth_getCode',[feed,block]));
     const round=await read(feed,'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)');
     const decimals=await read(feed,'function decimals() view returns(uint8)');
     if(!Array.isArray(round)||round.length!==5||round[1]<=0n||uint(round[3])>BigInt(Number.MAX_SAFE_INTEGER)
      ||round[3]===0n||round[3]>BigInt(Number(r.quantity(header.timestamp)))||!Number.isSafeInteger(decimals)||decimals<0||decimals>18)throw Error('FEED_ROUND_STOP');
     oracle={...oracle,feed_observation:{round_id:round[0].toString(),answer_raw:round[1].toString(),updated_at:round[3].toString(),decimals},
      effective_price_updated_at:null,effective_price_timestamp_status:'UNKNOWN_SOURCE_BINDING'};
    }
   }catch(error){oracle={status:'UNKNOWN',price_source_mode:'UNKNOWN',freshness:'UNKNOWN',effective_price_updated_at:null,reason:error.message};}
   const end=r.validateHeader(await q(url,'eth_getBlockByNumber',[block,false]),block);
   if(end.hash!==header.hash||end.timestamp!==header.timestamp)throw Error('REORG_STOP');
   return {block_hash:header.hash,block_timestamp:Number(r.quantity(header.timestamp)),controller_runtime_sha256:controllerHash,markets,assets_entered:entered,ledger,vai,oracle};
  }));
  const failed=providerResults.find(x=>x.status==='rejected');if(failed)throw failed.reason;
  const rows=providerResults.map(x=>x.value);
  if(stable(rows[0])!==stable(rows[1]))throw Error('QUORUM_STOP');
  const final=safeTime(clock());if(final<initial||final<rows[0].block_timestamp||final-rows[0].block_timestamp>MAX_SECONDS)throw Error('FRESHNESS_STOP');
  const marketsComplete=rows[0].ledger.every(x=>x.status==='OBSERVED');
  const complete=marketsComplete&&rows[0].vai.status==='OBSERVED'&&rows[0].oracle.status==='OBSERVED';
  return {status:complete?'CORE_OBSERVATIONAL_ONLY':'CORE_PARTIAL_UNKNOWN',...safety,kind:request===r.rpc&&clock===systemClock?'OBSERVED':'SYNTHETIC',
   chain_id:97,wallet:F.owner,controller:F.controller,block_number:height.toString(),...rows[0],complete_core_market_observation:marketsComplete,
   complete_core_observation:complete,scope:'Registered Core markets plus VAI getter observations and native oracle evidence; other protocols excluded',oracle_freshness:'UNKNOWN',
   checked_at:new Date(final*1000).toISOString(),costs:{...costs,elapsed_ms:Math.round(performance.now()-wallStart)}};
 }catch(error){return {status:'CORE_OBSERVER_STOP',reason:error.message,...safety,complete_core_market_observation:false,complete_core_observation:false,
  block_number:block===null?null:BigInt(block).toString(),oracle_freshness:'UNKNOWN',ledger:null,costs:{...costs,elapsed_ms:Math.round(performance.now()-wallStart)}};}
}
module.exports={observeCore,marketList,decode,ALLOWED,CORE,coreRpc,LEGACY};
if(require.main===module){
 if(process.argv.length===3&&process.argv[2]==='--read')observeCore().then(x=>{console.log(JSON.stringify(x));if(x.status==='CORE_OBSERVER_STOP')process.exitCode=1;}).catch(()=>{process.exitCode=1;});
 else console.log(JSON.stringify({status:'NO_EXECUTION',...safety}));
}
