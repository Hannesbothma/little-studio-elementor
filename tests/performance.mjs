import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true}),origin=process.env.LSE_TEST_URL;
const pixel={name:'pixel.png',type:'image/png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII='};
try{
 const measurements=[];
 for(const version of ['before','after']){
  const page=await browser.newPage();
  if(version==='before')await page.route('**/assets/admin.js*',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(process.env.LSE_BENCH_BASELINE,'utf8')}));
  await page.addInitScript(()=>{window.benchmarkRequests={};const original=fetch;window.fetch=function(url,options){const action=options?.body instanceof FormData?options.body.get('action'):null;if(action?.startsWith('lse_')){const key=action.slice(4);benchmarkRequests[key]=(benchmarkRequests[key]||0)+1;}return original.call(this,url,options);};});
  await page.goto(origin+'/wp-admin/admin.php?page=little-studio-elementor');await page.waitForFunction(()=>window.LSEAdmin&&window.LSEManage);
  const project={format:'little-studio-website',version:1,site_id:'performance-'+version,title:'Performance '+version,site_css:'',assets:Array.from({length:4},(_,i)=>({...pixel,url:'https://source.example/bench-'+i+'.png'})),fonts:[],pages:Array.from({length:2},(_,i)=>({key:'page-'+i,title:'Benchmark '+i,slug:'benchmark-'+version+'-'+i,url:'https://source.example/'+version+'/'+i+'/',parent_key:'',html:'<main><h1>Editable benchmark</h1><img src="https://source.example/bench-0.png" alt="Benchmark"><p>Same content and media in both runs.</p></main>',css:'main{padding:40px}h1{font-size:44px}',js:''})),site:{home_key:'page-0',navigation:[]}};
  await page.locator('#lse-file').setInputFiles({name:'performance.website.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(()=>LSEAdmin.project&&!LSEAdmin.busy);
  const result=await page.evaluate(async()=>{benchmarkRequests={};const start=performance.now();await LSEAdmin.run();return{ms:Math.round(performance.now()-start),state:LSEAdmin.job?.state,requests:benchmarkRequests};});
  assert.equal(result.state,'ready',await page.locator('#lse-status').innerText());measurements.push({version,...result});await page.close();
 }
 const result={fixture:'Two editable pages and four small media references; same server, reused media, no source scripts',measurements};await writeFile('tests/results/performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
