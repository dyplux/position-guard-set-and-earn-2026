'use strict';
function canonical(value){
 function sort(x){if(x===null||typeof x==='string'||typeof x==='boolean')return x;if(typeof x==='number'&&Number.isSafeInteger(x))return x;if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));throw Error('CANONICAL_VALUE_STOP');}
 return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
module.exports={canonical};
