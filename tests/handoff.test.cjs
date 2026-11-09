const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function schedule('),html.indexOf('function simulate()'));
function setup(){
 const settings={mday:{value:'1'},weekday:{value:'1'}};
 const context={st:{freq:'month'},$:id=>settings[id],parseISO:t=>new Date(t+'T00:00:00Z'),iso:d=>d.toISOString().slice(0,10),lowerBound:(rows,t)=>{const i=rows.findIndex(r=>r.t>=t);return i<0?rows.length:i;}};
 vm.createContext(context);vm.runInContext(source,context);return {context,settings};
}
const rows=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'].map(t=>({t}));
test('handoff preview uses current monthly rule, and explicit daily preview does not mutate it',()=>{
 const {context:c}=setup();assert.equal(c.schedule(rows,'2026-11-02','2026-11-06').length,0);
 assert.equal(c.schedule(rows,'2026-11-02','2026-11-06','day').length,5);
 assert.equal(c.st.freq,'month');assert.equal(c.schedule(rows,'2026-11-02','2026-11-06').length,0);
});
test('preview shifts an in-range holiday target to next trading date, without reaching past end',()=>{
 const {context:c}=setup();assert.deepEqual(Array.from(c.schedule(rows,'2026-11-01','2026-11-06')),[0]);
 assert.equal(c.schedule(rows,'2026-11-01','2026-11-01').length,0);
 assert.deepEqual(Array.from(c.schedule(rows,'2026-11-02','2026-11-06','week')),[0]);
});
