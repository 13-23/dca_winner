(() => {
"use strict";
const metrics=[
["gpu","GPU 임대료 (USD/GPU·시간)",-1,10,35],["util","GPU 가동률 (%)",-1,5,35],["openai","OpenAI 매출 성장률 (%)",-1,10,120],["anthropic","Anthropic 매출 성장률 (%)",-1,10,120],["capex","빅테크 CAPEX 가이던스 증가율 (%)",-1,10,120],["cds","CoreWeave 5년 CDS (bp)",1,100,35],["inventory","NVIDIA 재고 증가율 − 매출 증가율 (%p)",1,10,120],["receivables","NVIDIA 매출채권 증가율 − 매출 증가율 (%p)",1,10,120],["used","GPU 중고 가격 (USD)",-1,10,35],["fcf","빅테크 FCF (십억 USD)",-1,10,120],["debt","빅테크 순부채 (십억 USD)",1,10,120],["yield","미국 10년 국채 금리 (%)",1,0.5,7]];
const key="ai-cycle-v1", body=document.getElementById("ai-rows"), summary=document.getElementById("ai-summary");
let saved={};try{saved=JSON.parse(localStorage.getItem(key)||"{}")||{}}catch{}
const rows=metrics.map(([id,label,dir,threshold,days])=>{
const tr=document.createElement("tr");body.append(tr);
const cell=()=>{const td=document.createElement("td");tr.append(td);return td};
cell().textContent=label;
const input=(type,name)=>{const el=document.createElement("input");el.type=type;el.setAttribute("aria-label",label+" "+name);if(type==="number")el.step="any";el.value=saved[id]?.[name]??"";cell().append(el);return el};
const a=input("number","current"),b=input("number","previous"),date=input("date","date"),source=input("text","source"),status=cell();
source.placeholder="출처 / 비교 기간";
return {id,dir,threshold,days,a,b,date,source,status};
});
function render(){let warnings=0,valid=0;for(const r of rows){const age=(Date.now()-Date.parse(r.date.value))/86400000;const a=r.a.valueAsNumber,b=r.b.valueAsNumber;
if(!Number.isFinite(a)||!Number.isFinite(b)||!r.source.value.trim()||!Number.isFinite(age)||age< -1||age>r.days){r.status.textContent="자료 부족 / 오래됨";continue}
const relative=["gpu","used"].includes(r.id);if(relative&&b<=0){r.status.textContent="비교값 오류";continue}
const delta=relative?100*(a-b)/b:a-b;const warn=delta*r.dir>=r.threshold;valid++;warnings+=Number(warn);r.status.textContent=(delta>0?"+":"")+delta.toFixed(2)+(relative?"%":"")+" · "+(warn?"주의":"기준 미충족");}
summary.textContent="유효 지표 "+valid+"/"+rows.length+" · 주의 "+warnings+"개 (임시 기준, 백테스트 미실시)";}
for(const r of rows)for(const el of [r.a,r.b,r.date,r.source])el.addEventListener("input",render);
document.getElementById("ai-save").addEventListener("click",()=>{const data={};for(const r of rows)data[r.id]={current:r.a.value,previous:r.b.value,date:r.date.value,source:r.source.value};try{localStorage.setItem(key,JSON.stringify(data));render();summary.textContent+=" · 저장됨"}catch{summary.textContent="저장 실패"}});
document.getElementById("ai-reset").addEventListener("click",()=>{if(!confirm("이 브라우저의 AI 지표 입력을 초기화할까요?"))return;try{localStorage.removeItem(key)}catch{}for(const r of rows)for(const el of [r.a,r.b,r.date,r.source])el.value="";render()});render();
fetch("data/ai-cycle.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("unavailable");return r.json()}).then(data=>{for(const r of rows){const v=data[r.id];if(!v||[r.a,r.b,r.date,r.source].some(el=>el.value))continue;r.a.value=v.current;r.b.value=v.previous;r.date.value=v.date;r.source.value=v.source}render()}).catch(()=>{});
})();