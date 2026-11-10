import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const origin=process.env.LSE_TEST_URL||'http://127.0.0.1:9415';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('dialog',d=>d.accept());
const dir=new URL('./results/',import.meta.url);await mkdir(dir,{recursive:true});
const rpc=(action,args={})=>page.evaluate(([action,args])=>window.LSEAdmin.request(action,args),[action,args]);
const choose=async(data,name='test.website.json')=>{
 await page.locator('#lse-file').setInputFiles({name,mimeType:name.endsWith('.html')?'text/html':'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
 await page.waitForFunction(()=>window.LSEAdmin.project!==null);
};
const run=async()=>{
 await page.evaluate(()=>window.LSEAdmin.run());
 assert.equal(await page.evaluate(()=>window.LSEAdmin.job?.state),'ready',await page.locator('#lse-status').innerText());
 return page.evaluate(()=>window.LSEAdmin.job);
};
const refresh=async(data,name='test.website.json')=>{
 const chooser=page.waitForEvent('filechooser');await page.locator('#lse-refresh-import').click();
 await(await chooser).setFiles({name,mimeType:name.endsWith('.html')?'text/html':'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
 await page.waitForFunction(()=>window.LSEAdmin.project!==null&&window.LSEManage.target!==null);
};
const fixture={format:'little-studio-website',version:1,site_id:'management-fixture',title:'Management test site',site_css:'body{color:#243442;font-family:Arial}',pages:[
 {key:'home',title:'Home',slug:'lse-test-home',url:'https://source.example/home/',parent_key:'',html:'<div class="fixture" data-page="index.html"><header><button type="button" aria-controls="fixture-dialog">Open dialog</button></header><main><h1>Original heading</h1><p>Local fixture content</p><img src="https://source.example/pixel.png" alt="Fixture pixel"><a href="https://source.example/about/">About</a></main><dialog id="fixture-dialog">Local dialog</dialog></div>',css:'main{padding:40px}h1{font-size:44px}',js:'window.fixture=/\\d+/.test("123");'},
 {key:'about',title:'About',slug:'lse-test-about',url:'https://source.example/about/',parent_key:'',html:'<main><h1>About fixture</h1><p>Second page</p></main>',css:'main{padding:32px}',js:''}
],assets:[{url:'https://source.example/pixel.png',name:'pixel.png',type:'image/png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII='}],fonts:[],site:{home_key:'home',navigation:[{key:'home',label:'Home'},{key:'about',label:'About'}]}};
try{
 await page.goto(origin+'/wp-admin/admin.php?page=little-studio-elementor');
 await page.waitForFunction(()=>window.LSEAdmin&&window.LSEManage);
 const versions=await rpc('test',{operation:'versions'});
 await choose(fixture);const original=await run();const id=original.pages[0].id;const ids=original.pages.map(p=>p.id);
 const native=await rpc('test',{id});assert(native.elements?.length);assert.match(native.js,/\\d/);
 assert.match(JSON.stringify(native.elements),/"widgetType":"heading"/,'Distant dialog controls swallowed native headings');
 const front=await page.evaluate(id=>fetch('/?page_id='+id+'&preview=true').then(r=>r.text()),id);assert.match(front,/data-page="index\.html"/,'Source data attributes were lost');
 assert.equal(original.assets.length,1);
 assert((await rpc('imports')).imports.some(j=>j.id===original.id));
 const updated=structuredClone(fixture);updated.pages[0].html=updated.pages[0].html.replace('Original heading','Refreshed heading');
 await refresh(updated);const refreshed=await run();assert.deepEqual(refreshed.pages.map(p=>p.id),ids);
 assert.equal(refreshed.assets[0].id,original.assets[0].id,'Refresh duplicated identical media');
 assert.match(JSON.stringify((await rpc('test',{id})).elements),/Refreshed heading/);
 assert((await rpc('test',{id})).backup);
 const beforeRestore=await rpc('status',{job:original.id});
 await rpc('restore_refresh',{job:original.id,key:'home',expected_stamp:beforeRestore.pages[0].current_stamp,consent:true});
 assert.match(JSON.stringify((await rpc('test',{id})).elements),/Original heading/);
 // Save through Elementor's own document API, then prove refresh protects that edit.
 await rpc('test',{operation:'edit',id});
 const edited=await rpc('status',{job:original.id});assert(edited.pages[0].changed);
 const start={target_job:original.id,site_id:fixture.site_id,fingerprint:'a'.repeat(64),title:fixture.title,pages:fixture.pages.map(({key,title,slug,url,parent_key})=>({key,title,slug,url,parent_key})),site:fixture.site,layout:'elementor_canvas',scripts:true,expected_stamps:Object.fromEntries(edited.pages.map(p=>[p.key,p.current_stamp]))};
 await assert.rejects(()=>rpc('start',start),/edited or published/);
 assert.match(JSON.stringify((await rpc('test',{id})).elements),/Native Elementor edit/);
 // Explicit replacement updates existing pages, with the same IDs and status.
 await rpc('test',{operation:'publish',id});const published=await rpc('status',{job:original.id});
 await assert.rejects(()=>rpc('start',{...start,overwrite:true,expected_stamps:start.expected_stamps}),/changed after/);
 const resumed=await rpc('start',{...start,overwrite:true,expected_stamps:Object.fromEntries(published.pages.map(p=>[p.key,p.current_stamp]))});
 for(const source of fixture.pages){const converted=await page.evaluate(async({fixture,source,map})=>window.LSEConverter.convert(fixture,source,{map,layout:'elementor_canvas',preserveCSS:true}),{fixture,source,map:resumed.map});await rpc('page',{job:original.id,key:source.key,...converted})}
 let finished;do{finished=await rpc('finish',{job:original.id})}while(finished.state==='finishing');
 assert.equal((await rpc('test',{id})).post.status,'publish');assert.deepEqual(finished.pages.map(p=>p.id),ids);
 await assert.rejects(()=>rpc('undo',{job:original.id}),/refresh of existing pages/);
 const safe=await rpc('status',{job:original.id});const newSlug='renamed-imported-page-'+id;
 const meta=await rpc('manage_page',{job:original.id,key:'home',operation:'metadata',expected_stamp:safe.pages[0].current_stamp,title:'Renamed imported page',slug:newSlug});
 assert.equal((await rpc('test',{id})).post.slug,newSlug);
 const trashed=await rpc('manage_page',{job:original.id,key:'home',operation:'trash',expected_stamp:meta.pages[0].current_stamp,consent:true});assert.equal((await rpc('test',{id})).post.status,'trash');
 const restored=await rpc('manage_page',{job:original.id,key:'home',operation:'untrash',expected_stamp:trashed.pages[0].current_stamp});assert.equal((await rpc('test',{id})).post.status,'draft');
 await assert.rejects(()=>rpc('manage_page',{job:original.id,key:'foreign-page',operation:'trash',expected_stamp:restored.pages[0].current_stamp,consent:true}),/does not belong/);
 assert((await rpc('test',{operation:'foreign-owner',job:original.id})).denied);
 // Exercise HTML file selection and conversion through the same public import UI.
 await page.locator('#lse-another').click();await choose('<!doctype html><title>HTML source</title><style>h1{color:rgb(20,90,110)}</style><main><h1>Plain HTML import</h1></main>','standalone.html');
 const html=await run();assert.match(JSON.stringify((await rpc('test',{id:html.pages[0].id})).elements),/Plain HTML import/);
 // The users' real exports are read, validated, and representative pages converted without changing the source files.
 const paths=[
  '/run/media/hannes/Extreme SSD/AI/01-Projects/Hannes-Bothma/Website-JSON/round-02/hannes-bothma-website-clean.json',
  '/run/media/hannes/Extreme SSD/AI/Little Studio/Little Studio Desktop/exports/opu-jewelry-gallery.website.json'
 ];
 const actual=[];
 for(const path of paths){
  if(process.env.CI)continue;
  const text=await readFile(path,'utf8');
  const review=await page.evaluate(async text=>{const p=window.LSEConverter.validate(JSON.parse(text));const selected=[p.pages[0],p.pages.find(x=>/product/.test(x.key))||p.pages[1]];const outputs=[];for(const source of selected){const out=await window.LSEConverter.convert(p,source,{map:{},layout:'elementor_canvas',preserveCSS:true});outputs.push({key:source.key,elements:out.counts.native,fallbacks:out.fallbacks,warnings:out.warnings})}return{title:p.title,pages:p.pages.length,assets:p.assets.length,converted:outputs}},text);
  assert(review.converted.every(p=>p.elements>10),'Ordinary website content was swallowed by an HTML interaction region');actual.push(review);
 }
 await page.locator('#lse-reload-imports').click();await page.screenshot({path:fileURLToPath(new URL('management.png',dir)),fullPage:true});
 assert.deepEqual(failures,[],'Unexpected browser errors');
 const updater=process.env.LSE_TEST_UPDATER?await rpc('test',{operation:'updater',id}):null;
 const result={ok:true,versions,initialImport:true,refreshSameIds:true,sourceJSBackslashes:true,restoreRefresh:true,nativeElementorEditProtected:true,publishedRefreshConsent:true,concurrentEditProtected:true,titleAndSlug:true,trashRestore:true,foreignPageAndAccountDenied:true,htmlImport:true,actualWebsiteConversions:actual,updater};
 await writeFile(new URL('integration.json',dir),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await writeFile(new URL('integration-error.json',dir),JSON.stringify({ok:false,error:error.message,stack:error.stack,browserErrors:failures},null,2));await page.screenshot({path:fileURLToPath(new URL('failure.png',dir)),fullPage:true}).catch(()=>{});throw error}
finally{await browser.close()}
