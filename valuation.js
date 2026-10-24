(function(root){
'use strict';
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function evaluate(snapshot,price){
 if(!snapshot||!positive(snapshot.referencePrice)||!positive(price))return {per:null,pbr:null,eps:null,bps:null};
 const eps=positive(snapshot.per)?snapshot.referencePrice/snapshot.per:null,bps=positive(snapshot.pbr)?snapshot.referencePrice/snapshot.pbr:null;
 return {eps,bps,per:eps?price/eps:null,pbr:bps?price/bps:null};
}
function multiples(text){
 const parts=String(text).split(',').map(t=>t.trim());
 if(!parts.length||parts.length>5||parts.some(t=>!t||!positive(Number(t))))throw Error('배수는 0보다 큰 숫자를 쉼표로 구분해 최대 5개 입력해 주세요.');
 return [...new Set(parts.map(Number))].sort((a,b)=>a-b);
}
function bands(snapshot,price,perMultiples,pbrMultiples){
 const v=evaluate(snapshot,price),out=[];
 for(const [type,base,levels] of [['PER',v.eps,perMultiples],['PBR',v.bps,pbrMultiples]])if(base)for(const multiple of levels)if(positive(multiple))out.push({type,multiple,price:base*multiple});
 return out;
}
const api={evaluate,multiples,bands,positive};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValuationModel=api;
})(typeof window!=='undefined'?window:globalThis);
