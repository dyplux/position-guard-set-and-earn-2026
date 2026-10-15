/* Bounded wire JSON. No filesystem, environment, wallet or transport. */
'use strict';
const {TextDecoder}=require('node:util');
function parseStrict(input,limit=32768){
 if(typeof input!=='string'&&!Buffer.isBuffer(input))throw Error('WIRE_BYTES_REQUIRED');
 const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
 if(!Number.isSafeInteger(limit)||limit<1||limit>1048576||!bytes.length||bytes.length>limit)throw Error('WIRE_SIZE_STOP');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let at=0;
 function ws(){while(at<text.length&&/[\x20\t\r\n]/.test(text[at]))at++;}
 function string(){const start=at++;while(at<text.length){const c=text[at++];if(c==='"')return JSON.parse(text.slice(start,at));if(c==='\\'){if(at>=text.length)throw Error('WIRE_STRING_STOP');at++;}else if(c.charCodeAt(0)<32)throw Error('WIRE_STRING_STOP');}throw Error('WIRE_STRING_STOP');}
 function value(depth){
  if(depth>64)throw Error('WIRE_DEPTH_STOP');ws();const c=text[at];
  if(c==='"'){string();return;}
  if(c==='{'||c==='['){at++;ws();const end=c==='{'?'}':']',keys=new Set();if(text[at]===end){at++;return;}
   for(;;){if(c==='{'){if(text[at]!=='"')throw Error('WIRE_KEY_STOP');const key=string();if(keys.has(key))throw Error('WIRE_DUPLICATE_KEY_STOP');keys.add(key);ws();if(text[at++]!==':')throw Error('WIRE_COLON_STOP');}value(depth+1);ws();if(text[at]===end){at++;return;}if(text[at++]!==',')throw Error('WIRE_SEPARATOR_STOP');ws();}
  }
  const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));if(!token)throw Error('WIRE_VALUE_STOP');at+=token[0].length;
 }
 value(0);ws();if(at!==text.length)throw Error('WIRE_TRAILING_STOP');
 return JSON.parse(text,(_,v)=>{if(typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v)))throw Error('WIRE_NUMBER_STOP');return v;});
}
function fields(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('FIELDS_STOP');
 const keys=Reflect.ownKeys(value);
 if(keys.some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(value,k))||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(value,k);return !d.enumerable||!('value'in d);}))throw Error('FIELDS_STOP');
}
function rawUint(value,{positive=false}={}){if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>=2n**256n||positive&&value==='0')throw Error('RAW_UINT_STOP');return BigInt(value);}
function epoch(value){if(!Number.isSafeInteger(value)||value<=0)throw Error('EPOCH_STOP');return value;}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
module.exports={parseStrict,fields,rawUint,epoch,freeze};
