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
function assess(snapshot, days, manual=false){
 const latest=days.at(-1);
 if(!snapshot||!latest)return {reason:'missing'};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOf)||snapshot.asOf>latest[0])return {reason:'future'};
 if(!positive(snapshot.referencePrice))return {reason:'quote-only'};
 if(!manual&&snapshot.status==='stale')return {reason:'stale'};
 const anchor=days.find(row=>row[0]===snapshot.asOf);
 if(!anchor)return {reason:'no-anchor'};
 if(Math.abs(snapshot.referencePrice/anchor[1]-1)>.005)return {reason:'mismatch',anchor:anchor[1]};
 const from=manual?snapshot.asOf:snapshot.availableOn||latest[0];
 return from>latest[0]?{reason:'future'}:{reason:null,from};
}
const reasons={
 missing:'확정 종가와 기준 배수가 필요합니다.',
 future:'기준일 또는 발표일 이후의 확정 종가를 기다리는 중입니다.',
 'quote-only':'출처 배수만 제공합니다. 배수 산출에 사용한 같은 거래일의 지수값을 확인할 수 없어 가격 환산을 보류했습니다.',
 stale:'갱신 실패로 이전 배수를 표시합니다. 가격 환산은 보류했습니다.',
 'no-anchor':'기준일이 확정 종가 이력에 없어 가격 환산을 보류했습니다.',
 mismatch:'같은 날짜의 출처 기준값과 차트 종가가 0.5% 넘게 달라 가격 환산을 보류했습니다.'
};
function publishedSnapshot(references, automatic, symbol, basis='trailing'){
 const snapshot=references?.[basis]?.[symbol] || (basis==='trailing'&&automatic?.status!=='unavailable'?automatic:null);
 if(!snapshot?.pbrReview) return snapshot;
 return {...snapshot,pbr:null};
}
let archiveRequest;
function loadArchive(){
 if(!archiveRequest){
  const read=path=>fetch(path,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('자료 조회 실패');return r.json();});
  archiveRequest=Promise.allSettled([read('data/valuation-references.json'),read('data/valuations.json')]).then(([refs,auto])=>{
   if(refs.status==='rejected'||auto.status==='rejected')archiveRequest=null;
   return {references:refs.value,automatic:auto.value?.items};
  });
 }
 return archiveRequest;
}
const api={evaluate,multiples,bands,positive,assess,reasons,publishedSnapshot,loadArchive};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValuationModel=api;
})(typeof window!=='undefined'?window:globalThis);
