const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const names = ['browser','recovery-keyboard','pricing-groups','history','photo-inspection','photo-handoff','pricing-history','stock-discovery','stock-flows','pos-navigation','restock','older-data','receiving-filters','item-activity','intake-cancellation','phone-intake','pwa-share','session-navigation','settings','category-mappings','ai-fill'];
const results = [];
/** Own a fresh disposable preview per case so real login limits do not accumulate across independent test users. */
async function startPreview() {
 const child=spawn(process.execPath,[path.join(__dirname,'preview.cjs')],{cwd:root,stdio:'ignore',windowsHide:true});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 for(let attempt=0;attempt<100;attempt++){
  if(child.exitCode!==null)throw new Error('Disposable preview failed to start.');
  try {if((await fetch('http://127.0.0.1:5109/')).ok)return {child,exited};}catch{/* Wait only for this owned test process. */}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 child.kill();await exited;throw new Error('Disposable preview startup timed out.');
}
/** Run sequentially against local PostgreSQL; retain failed attempts and stop each owned server before the next case. */
async function run(){
 let occupied=false;try{await fetch('http://127.0.0.1:5109/');occupied=true;}catch{/* Expected: the dedicated preview port must be free. */}
 if(occupied)throw new Error('Port 5109 is occupied. Stop the dedicated test preview before running this isolated suite.');
 for(const name of names){
  const preview=await startPreview();
  const file=path.join(root,'app/tests',name+'.mjs');
  const source=fs.readFileSync(file,'utf8');
  const cwd=source.includes("'verification/")||name==='ai-fill'?root:path.join(root,'app');
  const log=fs.openSync(path.join(root,'verification',`release-${name}.log`),'w'),start=Date.now();
  let code;
  try {
   code=await new Promise(resolve=>{
    const child=spawn(process.execPath,[file],{cwd,stdio:['ignore',log,log],windowsHide:true,timeout:90000});
    child.on('exit',(exitCode,signal)=>resolve(signal?'timeout':exitCode));child.on('error',()=>resolve('error'));
   });
  }finally{fs.closeSync(log);preview.child.kill();await preview.exited;}
  results.push({name,code,milliseconds:Date.now()-start});console.log(name,code);
  fs.writeFileSync(path.join(root,'verification/browser-regression.json'),JSON.stringify({passed:results.every(row=>row.code===0),isolated_preview_per_case:true,results},null,2));
 }
 process.exitCode=results.some(row=>row.code!==0)?1:0;
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
