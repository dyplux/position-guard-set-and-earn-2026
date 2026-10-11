/* Private operator files and source inventory. No key loader or RPC. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const AUTHORITY=path.join(os.userInfo().homedir,'.config','position-guard-submit');
const UID=os.userInfo().uid;
function sha(value){return crypto.createHash('sha256').update(value).digest('hex');}
function directory(dir){
 const s=fs.lstatSync(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==UID||(s.mode&0o777)!==0o700)throw Error('PRIVATE_DIRECTORY_REQUIRED');
}
function privateBytes(file,limit=600000){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==UID||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>limit)throw Error('PRIVATE_FILE_REQUIRED');
  const bytes=fs.readFileSync(fd);if(bytes.length>limit)throw Error('FILE_LIMIT');return bytes;
 }finally{fs.closeSync(fd);}
}
function durable(file,value){
 directory(path.dirname(file));
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }catch(error){error.private_file_created=true;throw error;}
}
function sourceInventory(){
 const names=['operations/seller-submit.cjs','operations/seller_submit_io.cjs',
  'operations/seller_submit_guard.cjs','operations/seller_submit_preflight.cjs','operations/seller_submit_execution.cjs',
  'marketplace/funding.cjs','marketplace/negotiation.cjs','marketplace/submission.cjs','marketplace/seller_reconcile.cjs',
  'marketplace/erc8183.cjs','read_only/rpc.cjs','read_only/codec.cjs',
  'read_only/package.json','read_only/package-lock.json','policy.py'];
 const entries={};let total=0;
 function add(relative){
  const file=path.join(ROOT,relative),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||(s.uid!==UID&&s.uid!==0)||(s.mode&0o022)
    ||s.size>20000000||++total>16000)throw Error('SOURCE_FILE_STOP');
  entries[relative]=sha(fs.readFileSync(file));
 }
 function walk(relative){
  const parent=fs.lstatSync(path.join(ROOT,relative));
  if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.uid!==UID&&parent.uid!==0)||(parent.mode&0o022))throw Error('DEPENDENCY_DIRECTORY_STOP');
  for(const name of fs.readdirSync(path.join(ROOT,relative)).sort()){
   const next=relative+'/'+name,s=fs.lstatSync(path.join(ROOT,next));
   if(s.isSymbolicLink())throw Error('DEPENDENCY_SYMLINK_STOP');
   if(s.isDirectory())walk(next);else add(next);
  }
 }
 for(const name of names)add(name);
 walk('read_only/node_modules');
 entries['runtime:node']=sha(fs.readFileSync(process.execPath));
 entries['runtime:python']=sha(fs.readFileSync('/usr/bin/python3'));
 return {version:1,files:entries};
}
function reserveJobNonce(stateDir,value){
 if(!/^[1-9][0-9]{0,15}$/.test(value.job_id)||!Number.isSafeInteger(value.nonce)||value.nonce<0)throw Error('RESERVATION_INPUT_STOP');
 try{durable(path.join(stateDir,'job-'+value.job_id+'.lock'),value);}
 catch(error){if(error.private_file_created)error.reservation_owned=true;throw error;}
 try{durable(path.join(stateDir,'nonce-'+value.nonce+'.lock'),value);}
 catch(error){error.reservation_owned=true;throw error;}
}
function authority(){
 if(process.platform!=='darwin'||process.getuid()!==UID)throw Error('MAC_OPERATOR_REQUIRED');
 for(const name of ['', 'grants','state','seals'])directory(path.join(AUTHORITY,name));
}
module.exports={ROOT,AUTHORITY,UID,sha,directory,privateBytes,durable,sourceInventory,reserveJobNonce,authority};
