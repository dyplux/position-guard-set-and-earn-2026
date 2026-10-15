'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {parseStrict}=require('./lst_wire.cjs'),{canonical}=require('./lst_canonical.cjs'),q={canonical},UID=os.userInfo().uid;
function directory(value){if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value||fs.realpathSync(value)!==value)throw Error('PRIVATE_REAL_DIRECTORY_REQUIRED');const s=fs.lstatSync(value);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==UID||(s.mode&0o777)!==0o700)throw Error('PRIVATE_DIRECTORY_REQUIRED');return value;}
function privateRead(file){directory(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==UID||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>32768)throw Error('PRIVATE_FILE_REQUIRED');return parseStrict(fs.readFileSync(fd));}finally{fs.closeSync(fd);}}
function durable(file,value){
 directory(path.dirname(file));const bytes=Buffer.from(q.canonical(value));if(bytes.length>32768)throw Error('PRIVATE_RECORD_SIZE_STOP');
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 catch(e){e.private_file_created=true;throw e;}return {protected:true,durable:true};
}
module.exports={directory,privateRead,durable};
