import {handleEditorPrompts} from './editor-prompts.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const origin=process.env.LSE_TEST_URL||'http://127.0.0.1:9415';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const requestCounts={},importTimings=[];
await page.exposeFunction('recordLSERequest',action=>{requestCounts[action]=(requestCounts[action]||0)+1;});
await page.addInitScript(()=>{const original=window.fetch;window.fetch=function(url,options){const action=options?.body instanceof FormData?options.body.get('action'):null;if(typeof action==='string'&&action.startsWith('lse_'))window.recordLSERequest(action.slice(4));return original.call(this,url,options);};});
const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('dialog',d=>d.accept());
const dir=new URL('./results/',import.meta.url);await mkdir(dir,{recursive:true});
const rpc=async(action,args={})=>JSON.parse(await page.evaluate(async([action,args])=>JSON.stringify(await window.LSEAdmin.request(action,args)),[action,args]));
const choose=async(data,name='test.website.json')=>{
 await page.locator('#lse-file').setInputFiles({name,mimeType:name.endsWith('.html')?'text/html':'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
 await page.waitForFunction(()=>window.LSEAdmin.project!==null&&!window.LSEAdmin.busy);
};
const run=async()=>{
 const before={...requestCounts},started=performance.now();await page.evaluate(()=>window.LSEAdmin.run());importTimings.push({ms:Math.round(performance.now()-started),requests:Object.fromEntries(Object.entries(requestCounts).map(([key,value])=>[key,value-(before[key]||0)]).filter(([,n])=>n))});
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
],assets:[{url:'https://source.example/pixel.png',name:'aabbccddeeff00112233.png',type:'image/png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII='}],fonts:[],site:{home_key:'home',navigation:[{key:'home',label:'Home'},{key:'about',label:'About'}]}};
for(let i=1;i<=3;i++)fixture.assets.push({...fixture.assets[0],url:'https://source.example/pixel-'+i+'.png',name:'pixel-'+i+'.png'});
try{
 await page.goto(origin+'/wp-admin/admin.php?page=little-studio-elementor');
 await page.waitForFunction(()=>window.LSEAdmin&&window.LSEManage);
 const versions=await rpc('test',{operation:'versions'});
 // Exercise real URL capture, packaging, download and native Elementor import.
 await page.waitForFunction(()=>window.LSECapture);
 await assert.rejects(()=>rpc('capture_start',{url:'http://127.0.0.1/'}),/public HTTP/);
 await assert.rejects(()=>rpc('capture_start',{url:'file:///etc/passwd'}),/public HTTP/);
 const redirected=await rpc('capture_start',{url:'https://93.184.216.34/lse-capture/private-redirect',pages:1});
 await assert.rejects(()=>rpc('capture_step',{capture:redirected.capture,seq:0}),/public HTTP/);
 await rpc('capture_cancel',{capture:redirected.capture});
 const bulk=await rpc('capture_start',{url:'https://93.184.216.34/lse-capture/bulk/'});const bulkFirst=await rpc('capture_batch',{capture:bulk.capture,seq:0});assert(bulkFirst.records.length>4,'Capture still stops at four fast resources');assert.deepEqual(await rpc('capture_batch',{capture:bulk.capture,seq:0}),bulkFirst,'Larger capture response was not replayable');await rpc('capture_cancel',{capture:bulk.capture});console.log(JSON.stringify({captureBatchResources:bulkFirst.records.length}));
 const wide=await rpc('capture_start',{url:'https://93.184.216.34/lse-capture/wide/'});await rpc('capture_step',{capture:wide.capture,seq:0});const policy=await rpc('test',{operation:'capture-stats',capture:wide.capture});assert.equal(policy.seen,803);assert.equal(policy.maxPages,0);assert.equal(policy.depth,null);await rpc('capture_cancel',{capture:wide.capture});
 const repeated=await rpc('capture_start',{url:'https://93.184.216.34/lse-capture/',pages:2,depth:1});
 const firstResponse=await rpc('capture_step',{capture:repeated.capture,seq:0});
 const duplicateResponse=await rpc('capture_step',{capture:repeated.capture,seq:0});
 assert.deepEqual(duplicateResponse,firstResponse,'Retry lost or advanced the resource response');
 await assert.rejects(()=>rpc('capture_step',{capture:repeated.capture,seq:3}),/sequence/);
 await rpc('capture_cancel',{capture:repeated.capture});
 const batched=await rpc('capture_start',{url:'https://93.184.216.34/lse-capture/',pages:2,depth:1});
 const delivered=await rpc('capture_batch',{capture:batched.capture,seq:0});assert(delivered.records.length>1,'Capture did not batch small resources');
 assert.deepEqual(await rpc('capture_batch',{capture:batched.capture,seq:0}),delivered,'Lost batch response could not be replayed');
 await rpc('capture_cancel',{capture:batched.capture});
 await page.locator('[data-capture-open]').first().click();
 await page.locator('#lse-capture-url').fill('https://93.184.216.34/lse-capture/');
 assert.equal(await page.locator('#lse-capture-pages,#lse-capture-depth').count(),0);
 await page.setViewportSize({width:958,height:1000});
 const captureLayout=await page.evaluate(()=>{const d=document.querySelector('#lse-capture-dialog').getBoundingClientRect(),b=document.querySelector('#lse-capture-start').getBoundingClientRect();return {fits:d.left>=0&&d.right<=innerWidth,buttonFits:b.left>=d.left+10&&b.right<=d.right-10};});assert(captureLayout.fits&&captureLayout.buttonFits,'Capture dialog clips its controls');
 await page.screenshot({path:fileURLToPath(new URL('capture-dialog.png',dir)),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#lse-capture-start').click();
 await page.waitForFunction(()=>window.LSEAdmin.project?.capture&&!window.LSECapture.busy,{},{timeout:120000});
 const captured=await page.evaluate(()=>window.LSEAdmin.project);
 await writeFile(new URL('captured-website.json',dir),JSON.stringify(captured,(key,value)=>key==='bytes'?undefined:value,2));
 assert.equal(captured.site_id,'capture-'+createHash('sha256').update('https://93.184.216.34/lse-capture/').digest('hex').slice(0,24),'Desktop and WordPress capture identities differ');
 assert.equal(captured.pages[0].key,'page-'+createHash('sha256').update(captured.pages[0].url).digest('hex').slice(0,20));
 assert.equal(captured.pages.length,2);assert.equal(captured.assets.length,3,'Capture lost gallery/font files or failed to deduplicate media');
 assert.equal(captured.site.navigation.length,2);assert.match(captured.pages[0].css,/font-size:40px/);
 assert(captured.assets.some(a=>a.name==='courtyard-view.svg'),'Gallery image filename is not descriptive');
 assert.match(captured.pages[0].css,/@font-face/);assert(!captured.pages[0].js.includes('elementorFrontendConfig'),'Foreign Elementor initialization was embedded');
 assert.match(captured.pages[0].html,/capture-body/);assert.match(captured.pages[0].js,/capturedClassicScript/);
 assert.equal(await page.evaluate(()=>window.capturedClassicScript),undefined,'Capture executed source scripts');
 assert(captured.capture.warnings.some(w=>w.includes('JavaScript modules')));
 assert.match(await page.locator('#lse-findings').innerText(),/JavaScript modules/);
 const downloadEvent=page.waitForEvent('download');await page.locator('#lse-source-download').click();
 const downloaded=JSON.parse(await readFile(await(await downloadEvent).path(),'utf8'));
 assert.equal(downloaded.assets[0].bytes,undefined);assert(downloaded.assets.find(a=>a.type==='image/png').data.startsWith('data:image/png;base64,'));
 const capturedImport=await run();
 const capturedNative=await rpc('test',{id:capturedImport.pages[0].id});
 assert.match(JSON.stringify(capturedNative.elements),/"widgetType":"heading"/);
 assert.match(JSON.stringify(capturedNative.elements),/Captured native heading/);
 assert.match(JSON.stringify(capturedNative.elements),/Captured heading region/,'Source region semantics were lost while omitting empty wrappers');
 assert.match(capturedNative.css,/@font-face/,'Captured fonts were dropped from the saved styles');
 const galleryAsset=capturedImport.assets.find(a=>a.name==='courtyard-view.svg');assert(galleryAsset,'Gallery file was not uploaded');
 assert.equal((await rpc('test',{id:galleryAsset.id})).post.title,'Courtyard View');
 const frontend=await page.context().newPage();
 try{
  await frontend.goto(capturedImport.pages[0].preview_url,{waitUntil:'domcontentloaded'});
  await frontend.waitForFunction(()=>[...document.images].some(img=>img.complete&&img.naturalWidth===320));await frontend.waitForFunction(()=>window.capturedClassicScript===true);
  assert(await frontend.evaluate(()=>[...document.images].some(img=>img.naturalWidth===320&&img.getBoundingClientRect().width>600)),'Imported gallery image collapsed to an icon-sized thumbnail');
  const actual=await frontend.evaluate(()=>{const heading=[...document.querySelectorAll('h1')].find(n=>n.textContent==='Captured native heading');return{fontSize:getComputedStyle(heading).fontSize,color:getComputedStyle(heading).color,badIds:[...document.querySelectorAll('.elementor-element[data-id]')].map(n=>n.dataset.id).filter(id=>id.includes(' ')),foreignConfig:window.elementorFrontendConfig?.foreignSource,classicScript:window.capturedClassicScript};});
  assert.equal(actual.fontSize,'40px');assert.equal(actual.color,'rgb(17, 34, 51)');assert.deepEqual(actual.badIds,[]);assert.notEqual(actual.foreignConfig,true);assert.equal(actual.classicScript,true,'Enabled custom frontend interactions did not run on ordinary WordPress Preview');
  await writeFile(new URL('preview-geometry.json',dir),JSON.stringify(await frontend.evaluate(()=>[...document.images].map(img=>({src:img.currentSrc,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,parents:[img.parentElement,img.parentElement.parentElement,img.parentElement.parentElement.parentElement].map(el=>({className:el.className,width:el.getBoundingClientRect().width,display:getComputedStyle(el).display,grid:getComputedStyle(el).gridTemplateColumns}))}))),null,2));
  await frontend.screenshot({path:fileURLToPath(new URL('captured-preview.png',dir)),fullPage:true});
 }finally{await frontend.close();}
 const editor=await page.context().newPage(),editorStarted=performance.now();
 try{
  await editor.goto(capturedImport.pages[1].edit_url,{waitUntil:'domcontentloaded'});
  const canvas=editor.frameLocator('#elementor-preview-iframe');await handleEditorPrompts(editor,canvas.locator('.elementor-widget-heading').first());const heading=canvas.getByRole('heading',{name:'Captured About',exact:true});await heading.waitFor({state:'visible',timeout:90000});
  assert(!(await editor.locator('#elementor-preview-iframe').contentFrame().locator('body').innerHTML()).includes('capturedEditorScriptShouldNotRun'),'Source scripts were injected into Elementor editor preview');
  await editor.waitForFunction(()=>window.elementor?.loaded&&window.elementor?.previewLoadedOnce,{},{timeout:90000});await editor.locator('#elementor-loading').waitFor({state:'hidden',timeout:90000});const closeStructure=editor.getByRole('button',{name:'Close structure',exact:true});if(await closeStructure.isVisible())await closeStructure.click();const widget=canvas.locator('.elementor-widget-heading').filter({hasText:'Captured About'}).first();await widget.hover();await widget.locator('[aria-label="Edit Heading"]').click();const control=editor.locator('.elementor-control-title textarea').first();await control.waitFor({state:'visible',timeout:45000});await control.fill('Changed in the real Elementor editor');
  await canvas.getByRole('heading',{name:'Changed in the real Elementor editor',exact:true}).waitFor({state:'visible',timeout:15000});
  await editor.screenshot({path:fileURLToPath(new URL('elementor-editor-loaded.png',dir)),fullPage:true});
  console.log(JSON.stringify({actualElementorEditorLoadedAndEdited:true,ms:Math.round(performance.now()-editorStarted)}));
 }catch(error){await editor.screenshot({path:fileURLToPath(new URL('elementor-editor-failure.png',dir)),fullPage:true});await writeFile(new URL('elementor-editor-dom.json',dir),JSON.stringify(await editor.evaluate(()=>({text:document.body.innerText.slice(0,10000),controls:[...document.querySelectorAll('textarea,input')].map(n=>({tag:n.tagName,name:n.name,id:n.id,setting:n.dataset.setting,value:n.value?.slice(0,80)})),bodyClass:document.body.className})),null,2));throw error;}finally{await editor.close();}

 await rpc('test',{operation:'edit',id:capturedImport.pages[0].id});
 assert.match(JSON.stringify((await rpc('test',{id:capturedImport.pages[0].id})).elements),/Native Elementor edit/,'Deeply nested captured content is not editable');
 const capturedSaved=await rpc('status',{job:capturedImport.id});
 await rpc('remove_import',{job:capturedImport.id,consent:true,expected_stamps:Object.fromEntries(capturedSaved.pages.map(p=>[p.key,p.current_stamp]))});
 await page.reload();await page.waitForFunction(()=>window.LSEAdmin&&window.LSEManage&&window.LSECapture);

 await rpc('test',{operation:'slow-media',enabled:true});const uploadsBefore={assets:requestCounts.assets||0,asset:requestCounts.asset||0};
 await choose(fixture);const original=await run();assert.equal(original.assets[0].name,'fixture-pixel.png','Legacy hash filename was not replaced using image alt text');
 assert.equal(requestCounts.assets-uploadsBefore.assets,1,'A slow host kept receiving oversized batches');assert.equal(requestCounts.asset-uploadsBefore.asset,3,'Unprocessed media was skipped instead of uploaded individually');await rpc('test',{operation:'slow-media',enabled:false});const id=original.pages[0].id;const ids=original.pages.map(p=>p.id);
 const native=await rpc('test',{id});assert(native.elements?.length);assert.match(native.js,/\\d/);
 // Exercise the new workspace through the same controls used in WordPress.
 assert.equal(await page.locator('.lse-site[aria-current="true"]').count(),1);
 assert.equal(await page.locator('[data-managed-key]').count(),2);
 assert.equal(await page.locator('#lse-flow-dialog').isVisible(),false);
 assert(original.pages.every(item=>item.modified),'Page modification dates are missing');
 await page.locator('#lse-page-search').fill('About');
 assert.equal(await page.locator('[data-managed-key]').count(),1);
 assert.equal(await page.locator('#lse-page-inspector h3').innerText(),'About');
 await page.locator('#lse-page-search').clear();
 await page.locator('#lse-page-filter').selectOption('trash');
 assert.equal(await page.locator('[data-managed-key]').count(),0);
 await page.locator('#lse-page-filter').selectOption('all');
 await page.setViewportSize({width:430,height:900});
 await page.locator('[data-managed-key="home"]').click();
 assert.equal(await page.locator('#lse-page-inspector').isVisible(),true);
 await page.screenshot({path:fileURLToPath(new URL('mobile-workspace.png',dir)),fullPage:true});
 await page.locator('.lse-inspector-close').click();
 assert.equal(await page.locator('#lse-page-inspector').isVisible(),false);
 const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 assert.equal(mobileOverflow,false,'The mobile workspace scrolls horizontally');
 await page.setViewportSize({width:1440,height:1000});

 assert.match(JSON.stringify(native.elements),/"widgetType":"heading"/,'Distant dialog controls swallowed native headings');
 const front=await page.evaluate(id=>fetch('/?page_id='+id+'&preview=true').then(r=>r.text()),id);assert.match(front,/data-page="index\.html"/,'Source data attributes were lost');
 assert.equal(original.assets.length,4);assert.equal(new Set(original.assets.map(a=>a.id)).size,1,'Batch upload duplicated identical media');assert(requestCounts.assets>=1,'Multi-file upload was not exercised');
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
 await page.evaluate(()=>window.LSEManage.reload());
 await page.locator('[data-managed-key="home"]').click();
 const newSlug='renamed-imported-page-'+id;
 await page.locator('[data-operation="metadata"]').click();
 await page.locator('#lse-page-title').fill('Renamed imported page');
 await page.locator('#lse-page-slug').fill(newSlug);
 await page.locator('#lse-page-save').click();
 await page.waitForFunction(()=>!document.querySelector('#lse-page-dialog').open);
 assert.equal((await rpc('test',{id})).post.slug,newSlug);
 await page.locator('[data-operation="trash"]').click();
 await page.waitForFunction(()=>window.LSEManage.current.pages[0].post_status==='trash');
 assert.equal((await rpc('test',{id})).post.status,'trash');
 await page.locator('[data-operation="untrash"]').click();
 await page.waitForFunction(()=>window.LSEManage.current.pages[0].post_status==='draft');
 const restored=await rpc('status',{job:original.id});
 assert.equal((await rpc('test',{id})).post.status,'draft');
 await assert.rejects(()=>rpc('manage_page',{job:original.id,key:'foreign-page',operation:'trash',expected_stamp:restored.pages[0].current_stamp,consent:true}),/does not belong/);
 assert((await rpc('test',{operation:'foreign-owner',job:original.id})).denied);
 // Exercise HTML file selection and conversion through the same public import UI.
 await page.locator('#lse-new-import').click();await choose('<!doctype html><title>HTML source</title><style>h1{color:rgb(20,90,110)}</style><main><h1>Plain HTML import</h1></main>','standalone.html');
 const html=await run();assert.match(JSON.stringify((await rpc('test',{id:html.pages[0].id})).elements),/Plain HTML import/);
 // The users' real exports are read, validated, and representative pages converted without changing the source files.
 const paths=[
  '/run/media/hannes/Extreme SSD/AI/01-Projects/Hannes-Bothma/Website-JSON/round-02/hannes-bothma-website-clean.json',
  '/run/media/hannes/Extreme SSD/AI/Little Studio/Little Studio Desktop/exports/opu-jewelry-gallery.website.json'
 ];
 const actual=[];
 for(const path of paths){
  if(process.env.CI||process.env.LSE_SKIP_SSD)continue;
  const text=await readFile(path,'utf8');
  const review=await page.evaluate(async text=>{const p=window.LSEConverter.validate(JSON.parse(text));const selected=[p.pages[0],p.pages.find(x=>/product/.test(x.key))||p.pages[1]];const outputs=[];for(const source of selected){const out=await window.LSEConverter.convert(p,source,{map:{},layout:'elementor_canvas',preserveCSS:true});outputs.push({key:source.key,elements:out.counts.native,fallbacks:out.fallbacks,warnings:out.warnings})}return{title:p.title,pages:p.pages.length,assets:p.assets.length,converted:outputs}},text);
  assert(review.converted.every(p=>p.elements>10),'Ordinary website content was swallowed by an HTML interaction region');actual.push(review);
 }
 await page.evaluate(()=>window.LSEManage.reload());await page.screenshot({path:fileURLToPath(new URL('management.png',dir)),fullPage:true});
 assert.equal(await page.locator('#lse-result').count(),0,'A duplicate completion panel returned');
 assert.equal(await page.locator('.lse-card').count(),1,'The interface has multiple import workspaces');
 assert.equal(await page.locator('#lse-page-dialog').isVisible(),false,'The metadata dialog opens only when requested');
 assert.equal(await page.locator('#lse-page-inspector a.button-primary').count(),1,'The selected page has no Elementor link');
 await page.locator('[data-import-id="'+original.id+'"]').click();
 await page.waitForFunction(id=>window.LSEManage.current?.id===id,original.id);
 await rpc('test',{operation:'publish',id});await rpc('test',{operation:'publish',id:ids[1]});
 await rpc('activate',{job:original.id,consent:true});
 const removal=await rpc('status',{job:original.id});
 await assert.rejects(()=>rpc('remove_import',{job:original.id,consent:false,expected_stamps:Object.fromEntries(removal.pages.map(p=>[p.key,p.current_stamp]))}),/Confirm removing/);
 await rpc('test',{operation:'edit',id});
 await assert.rejects(()=>rpc('remove_import',{job:original.id,consent:true,expected_stamps:Object.fromEntries(removal.pages.map(p=>[p.key,p.current_stamp]))}),/changed after/);
 assert.equal((await rpc('test',{id})).post.status,'publish','Stale bulk removal partly deleted the import');
 await page.locator('#lse-import-menu > summary').click();
 let removalBrowserDialog=false;
 const recordRemovalDialog=()=>{removalBrowserDialog=true;};
 page.on('dialog',recordRemovalDialog);
 await page.locator('#lse-remove-import').click();
 await page.locator('#lse-remove-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#lse-remove-name').innerText(),original.title);
 await page.locator('#lse-remove-dialog button[value="cancel"]').click();
 assert.equal((await rpc('status',{job:original.id})).state,'ready','Cancel removed the import');
 await page.locator('#lse-import-menu > summary').click();
 await page.locator('#lse-remove-import').click();
 await page.locator('#lse-remove-dialog button[value="remove"]').click();
 await page.waitForFunction(id=>!Array.from(document.querySelector('#lse-import-list').options).some(o=>o.value===id),original.id);
 page.off('dialog',recordRemovalDialog);
 assert.equal(removalBrowserDialog,false,'Import deletion opened a browser confirmation');
 for(const postId of ids)assert.equal((await rpc('test',{id:postId})).post.status,'trash','Whole-import removal left a page behind');
 assert.equal((await rpc('test',{id:html.pages[0].id})).post.status,'draft','A different import was deleted');
 assert.equal((await rpc('test',{id:original.assets[0].id})).post.status,'inherit','Shared media was deleted');
 const removed=await rpc('status',{job:original.id});assert.equal(removed.state,'removed');assert.equal(removed.menu,0);
 assert.equal(removed.activated,false,'Imported homepage setup was left active');
 await page.screenshot({path:fileURLToPath(new URL('single-workspace.png',dir)),fullPage:true});
 assert.deepEqual(failures,[],'Unexpected browser errors');
 const updater=process.env.LSE_TEST_UPDATER?await rpc('test',{operation:'updater',id}):null;
 const result={ok:true,requestCounts,importTimings,versions,websiteURLCapture:true,captureRetryIdempotent:true,privateCaptureURLsDenied:true,privateRedirectDenied:true,capturedJSONDownload:true,capturedNativeElementor:true,actualElementorEditor:true,previewImagesAndStyles:true,descriptiveImageNames:true,deeplyNestedURLImport:true,batchedCaptureReplay:true,mediaBatches:true,compactPageSaves:true,initialImport:true,refreshSameIds:true,sourceJSBackslashes:true,restoreRefresh:true,nativeElementorEditProtected:true,publishedRefreshConsent:true,concurrentEditProtected:true,titleAndSlug:true,trashRestore:true,foreignPageAndAccountDenied:true,htmlImport:true,singleWorkspace:true,sidebarAndInspector:true,pageSearchAndFilters:true,mobileWorkspace:true,metadataDialog:true,wholeImportRemoval:true,staleBulkRemovalProtected:true,unrelatedImportRetained:true,actualWebsiteConversions:actual,updater};
 await writeFile(new URL('integration.json',dir),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await writeFile(new URL('integration-error.json',dir),JSON.stringify({ok:false,error:error.message,stack:error.stack,browserErrors:failures},null,2));await page.screenshot({path:fileURLToPath(new URL('failure.png',dir)),fullPage:true}).catch(()=>{});throw error}
finally{await browser.close()}
