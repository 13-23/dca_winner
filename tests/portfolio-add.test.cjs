const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../portfolio-ui.js'),'utf8');
const handlers=source.slice(source.indexOf('let searchTimer,searchVersion=0;'),source.indexOf("$('pf-search').addEventListener('input'"));
function setup(search){
 const elements={
  'pf-search':{value:'PSQ'},
  'pf-search-results':{textContent:'',replaceChildren(){this.textContent='';}},
  'pf-add':{disabled:false,addEventListener(_,fn){this.click=fn;}},
  'pf-assets':{lastElementChild:{querySelector:()=>({focus(){}})}}
 };
 const ctx={entries:[{symbol:'QQQ',weight:100}],list:[{symbol:'SPY',label:'S&P500'}],API:{search},$:id=>elements[id],clearTimeout(){},renderRows(){},changed(){},total(){}};
 vm.createContext(ctx);vm.runInContext(handlers,ctx);
 return {ctx,elements};
}
test('add button resolves typed PSQ instead of adding the first preset',async()=>{
 const {ctx,elements}=setup(async()=>({quotes:[{symbol:'PSQX',name:'other'},{symbol:'PSQ',name:'ProShares Short QQQ'}]}));
 await elements['pf-add'].click();
 assert.deepEqual(Array.from(ctx.entries,x=>x.symbol),['QQQ','PSQ']);assert.equal(ctx.entries[1].label,'ProShares Short QQQ');assert.equal(elements['pf-search'].value,'');
});
test('repeated clicks while search is pending add the asset only once',async()=>{
 let resolve;const {ctx,elements}=setup(()=>new Promise(r=>{resolve=r;}));
 const pending=elements['pf-add'].click();await elements['pf-add'].click();resolve({quotes:[{symbol:'PSQ'}]});await pending;
 assert.equal(ctx.entries.filter(x=>x.symbol==='PSQ').length,1);
});
test('changed query does not add a stale search result',async()=>{
 let resolve;const {ctx,elements}=setup(()=>new Promise(r=>{resolve=r;}));
 const pending=elements['pf-add'].click();elements['pf-search'].value='SH';resolve({quotes:[{symbol:'PSQ'}]});await pending;
 assert.equal(ctx.entries.length,1);
});
test('ambiguous search does not silently add an unrelated asset',async()=>{
 const {ctx,elements}=setup(async()=>({quotes:[{symbol:'PSQX'},{symbol:'PSQY'}]}));
 await elements['pf-add'].click();assert.equal(ctx.entries.length,1);assert.match(elements['pf-search-results'].textContent,/여러 개/);
});
