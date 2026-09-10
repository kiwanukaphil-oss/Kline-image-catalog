import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('components/upload-delivery.tsx', 'utf8');
const ast = ts.createSourceFile('upload-delivery.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let functionSource;
function findUploadFunction(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'uploadQueued') functionSource = node.getText(ast);
  ts.forEachChild(node, findUploadFunction);
}
findUploadFunction(ast);
assert.ok(functionSource);
const compiled = ts.transpileModule(functionSource, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
class ApiError extends Error { constructor(message,status) {super(message);this.status=status;} }

/** Execute the actual queue function with controlled API outcomes and assert which saved entries are removed. */
async function runQueueScenario(states, readbackFailure=false) {
  const photos = states.map((state,index)=>({id:String(index),batchId:'saved-batch',batchTitle:'Saved',categoryId:'shirts',
    file:new File(['image'], `${index}.jpg`, {type:'image/jpeg'}),state}));
  const pending = new Set(photos.map(photo=>photo.id));
  const calls=[]; let lastProgress=''; let completedBatch=null;
  const context={FormData,ApiError,branch:'branch',userId:'user',lifetime:{current:{signal:new AbortController().signal}},
    sessionStorage:{getItem:()=> 'session'},setProgress:value=>{lastProgress=value;},setPending:()=>{},setFiles:()=>{},
    readPendingPhotos:async()=>photos.filter(photo=>pending.has(photo.id)),finishPhoto:async id=>pending.delete(id),
    onComplete:id=>{completedBatch=id;},requestPos:async(path,branch,options={})=>{
      const id=options.body?.get('id') ?? path.split('/').at(-1);
      const state=photos[Number(id)].state;
      calls.push({id,path,method:options.method||'GET'});
      if(path==='/catalog/items') {
        if(state==='upload-failed') throw new ApiError('Upload failed',500);
        return {data:{pos_product_id:state==='received'?'existing-product':null}};
      }
      if(options.method==='PUT') {
        if(['receipt-race','other-conflict'].includes(state)) throw new ApiError('Conflict',409);
        return {added:true};
      }
      if(readbackFailure) throw new ApiError('Read failed',503);
      return {item:{is_published:state==='receipt-race'}};
    }};
  vm.createContext(context);
  vm.runInContext(compiled,context);
  let error;
  try {await context.uploadQueued(photos);} catch(cause){error=cause;}
  return {pending:[...pending],calls,lastProgress,completedBatch,error};
}

const mixed=await runQueueScenario(['received','new','received','receipt-race','new','received','new','received']);
assert.deepEqual(mixed.pending,[]);
assert.equal(mixed.error,undefined);
assert.equal(mixed.calls.filter(call=>call.method==='PUT').length,4);
assert.ok(!mixed.calls.some(call=>call.method==='PUT'&&['0','2','5','7'].includes(call.id)));
assert.equal(mixed.lastProgress,'3 photos added · 5 already received');
const allReceived=await runQueueScenario(['received','received']);
assert.deepEqual(allReceived.pending,[]);
assert.equal(allReceived.completedBatch,null);
assert.equal(allReceived.calls.length,2);
for (const [state,readbackFailure] of [['other-conflict',false],['receipt-race',true],['upload-failed',false]]) {
  const failed=await runQueueScenario([state,'new'],readbackFailure);
  assert.ok(failed.error);
  assert.deepEqual(failed.pending,['0','1']);
  assert.ok(failed.calls.every(call=>call.id==='0'));
}
fs.writeFileSync('../verification/upload-resume-received-test.json',JSON.stringify({passed:true,
  eight_entry_queue_completed:true,received_entries_not_reassigned:true,receipt_race_confirmed:true,
  unrelated_conflict_and_failed_readback_preserve_queue:true,production_requests:false},null,2));
console.log('PASS: received entries, mixed queue, receipt race and failed readback preserve upload/stock boundaries');
