const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,bands,multiples}=require('../valuation.js');
test('current ratios and fixed basis band prices use the same EPS/BPS',()=>{
 const snapshot={referencePrice:100,per:20,pbr:2};
 assert.deepEqual(evaluate(snapshot,120),{eps:5,bps:50,per:24,pbr:2.4});
 assert.deepEqual(bands(snapshot,120,[10,20,30],[1,2]),[
  {type:'PER',multiple:10,price:50},{type:'PER',multiple:20,price:100},{type:'PER',multiple:30,price:150},
  {type:'PBR',multiple:1,price:50},{type:'PBR',multiple:2,price:100}]);
});
test('missing or nonpositive fundamentals never fabricate a ratio or price band',()=>{
 for(const snapshot of [null,{}, {referencePrice:0,per:10,pbr:2},{referencePrice:100,per:-10,pbr:0}]){
  assert.equal(evaluate(snapshot,100).per,null);assert.equal(evaluate(snapshot,100).pbr,null);
  assert.deepEqual(bands(snapshot,100,[10],[1]),[]);
 }
 assert.deepEqual(evaluate({referencePrice:100,per:10},100),{per:10,pbr:null,eps:10,bps:null});
});
test('band multiples are positive finite numbers with an explicit five-line limit',()=>{
 assert.deepEqual(multiples('25, 15, 20, 15'),[15,20,25]);
 for(const text of ['', '0,1', '-1', 'NaN', 'Infinity', '1,', '1,2,3,4,5,6'])assert.throws(()=>multiples(text));
});
