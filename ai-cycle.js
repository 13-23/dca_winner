(() => {
"use strict";
const metrics=[
["gpu","GPU 임대료 (USD/GPU·시간)",-1,10,35],["util","GPU 가동률 (%)",-1,5,35],["openai","OpenAI 매출 성장률 (%)",-1,10,120],["anthropic","Anthropic 매출 성장률 (%)",-1,10,120],["capex","빅테크 CAPEX 가이던스 증가율 (%)",-1,10,120],["cds","CoreWeave 5년 CDS (bp)",1,100,35],["inventory","NVIDIA 재고 증가율 − 매출 증가율 (%p)",1,10,120],["receivables","NVIDIA 매출채권 증가율 − 매출 증가율 (%p)",1,10,120],["used","GPU 중고 가격 (USD)",-1,10,35],["fcf","빅테크 FCF (십억 USD)",-1,10,120],["debt","빅테크 순부채 (십억 USD)",1,10,120],["yield","미국 10년 국채 금리 (%)",1,0.5,7]];
const key="ai-cycle-v1", body=document.getElementById("ai-rows"), summary=document.getElementById("ai-summary");
const fields=["current","previous","date","source"];
let automatic={}, loadMessage="자동 데이터 불러오는 중";
let saved={};try{saved=JSON.parse(localStorage.getItem(key)||"{}")||{}}catch{}
const rows=metrics.map(([id,label,dir,threshold,days])=>{
const tr=document.createElement("tr");body.append(tr);
const cell=()=>{const td=document.createElement("td");tr.append(td);return td};
cell().textContent=label;
const input=(type,name)=>{const el=document.createElement("input");el.type=type;el.setAttribute("aria-label",label+" "+name);if(type==="number")el.step="any";el.value=saved[id]?.[name]??"";cell().append(el);return el};
const a=input("number","current"),b=input("number","previous"),date=input("date","date"),source=input("text","source"),status=cell();
source.placeholder="출처 / 비교 기간";
const inputs=[a,b,date,source];
const link=document.createElement("a");
link.textContent="원문";
link.target="_blank";
link.rel="noopener noreferrer";
link.hidden=true;
source.parentElement.append(" ",link);
return {id,dir,threshold,days,a,b,date,source,status,inputs,link,manual:inputs.some(el=>el.value)};
});
function applyAutomatic(){
for(const r of rows){
if(r.manual)continue;
r.inputs.forEach((input,i)=>{input.value=automatic[r.id]?.[fields[i]]??""});
}
}
function render(){let warnings=0,valid=0;for(const r of rows){const age=(Date.now()-Date.parse(r.date.value))/86400000;const a=r.a.valueAsNumber,b=r.b.valueAsNumber;
const autoStatus=automatic._status?.[r.id];
const label=r.manual?"직접 입력":autoStatus==="retained"?"자동 · 이전 값 유지":autoStatus==="ok"?"자동":autoStatus==="unavailable"?"자동 수집 실패":"";
const url=automatic[r.id]?.url;
r.link.hidden=r.manual||typeof url!=="string"||!/^https:\/\/(?:www\.sec\.gov|data\.sec\.gov|home\.treasury\.gov|fred\.stlouisfed\.org)\//.test(url);
if(!r.link.hidden)r.link.href=url;
const setStatus=message=>{r.status.textContent=[label,message].filter(Boolean).join(" · ")};
if(!Number.isFinite(a)||!Number.isFinite(b)||!r.source.value.trim()||!Number.isFinite(age)||age< -1||age>r.days){setStatus("자료 부족 / 오래됨");continue}
const relative=["gpu","used"].includes(r.id);if(relative&&b<=0){setStatus("비교값 오류");continue}
const delta=relative?100*(a-b)/b:a-b;const warn=delta*r.dir>=r.threshold;valid++;warnings+=Number(warn);setStatus((delta>0?"+":"")+delta.toFixed(2)+(relative?"%":["fcf","debt"].includes(r.id)?"십억 USD":r.id==="cds"?"bp":"%p")+" · "+(warn?"주의":"기준 미충족"));}
summary.textContent="유효 지표 "+valid+"/"+rows.length+" · 주의 "+warnings+"개 (임시 기준, 백테스트 미실시) · "+loadMessage;}
for(const r of rows)for(const el of r.inputs)el.addEventListener("input",()=>{r.manual=true;render()});
document.getElementById("ai-save").addEventListener("click",()=>{
const data={};
for(const r of rows){
if(r.manual&&r.inputs.some(el=>el.value)){
data[r.id]=Object.fromEntries(fields.map((field,i)=>[field,r.inputs[i].value]));
}else{
r.manual=false;
}
}
try{
localStorage.setItem(key,JSON.stringify(data));
applyAutomatic();
render();
summary.textContent+=" · 저장됨";
}catch{summary.textContent="저장 실패"}
});
document.getElementById("ai-reset").addEventListener("click",()=>{
if(!confirm("이 브라우저의 AI 지표 입력을 초기화할까요?"))return;
try{localStorage.removeItem(key)}catch{summary.textContent="초기화 실패";return}
for(const r of rows)r.manual=false;
applyAutomatic();
render();
});
render();
fetch("data/ai-cycle.json",{cache:"no-store"}).then(response=>{
if(!response.ok)throw Error("unavailable");
return response.json();
}).then(data=>{
automatic=data;
loadMessage="자동 수집 "+rows.filter(r=>automatic[r.id]).length+"/"+rows.length;
applyAutomatic();
render();
}).catch(()=>{
loadMessage="자동 데이터 불러오기 실패";
render();
});
})();
