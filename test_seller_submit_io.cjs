const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {privateBytes,durable,directory}=require('./operations/seller_submit_io.cjs');
test('private inputs reject readable files, symlinks, hard links and oversize',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seller-io-'));fs.chmodSync(root,0o700);
 try{
  const file=path.join(root,'packet.json');fs.writeFileSync(file,'{}',{mode:0o600});
  assert.equal(privateBytes(file).toString(),'{}');assert.throws(()=>privateBytes(file,1));
  fs.chmodSync(file,0o644);assert.throws(()=>privateBytes(file));fs.chmodSync(file,0o600);
  const link=path.join(root,'alias');fs.symlinkSync(file,link);assert.throws(()=>privateBytes(link));fs.unlinkSync(link);
  fs.linkSync(file,link);assert.throws(()=>privateBytes(file));
 }finally{fs.rmSync(root,{recursive:true});}
});
test('durable journal is exclusive and requires an owner-private parent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seller-journal-'));fs.chmodSync(root,0o700);
 try{
  const file=path.join(root,'SIGNED.json');durable(file,{signatures:1});
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.throws(()=>durable(file,{signatures:2}));
  fs.chmodSync(root,0o755);assert.throws(()=>directory(root));assert.throws(()=>durable(path.join(root,'other.json'),{}));
 }finally{fs.rmSync(root,{recursive:true});}
});
test('a failed fsync preserves ownership of the newly created reservation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seller-partial-'));fs.chmodSync(root,0o700);
 const original=fs.fsyncSync;
 try{
  fs.fsyncSync=()=>{throw Error('FSYNC_TEST_FAILURE');};
  assert.throws(()=>durable(path.join(root,'job.lock'),{}),error=>error.private_file_created===true);
  assert.equal(fs.existsSync(path.join(root,'job.lock')),true);
 }finally{fs.fsyncSync=original;fs.rmSync(root,{recursive:true});}
});
