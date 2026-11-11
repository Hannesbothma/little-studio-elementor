import{chromium}from'playwright';import assert from'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(process.env.LSE_TEST_URL+'/wp-admin/admin.php?page=little-studio-elementor');await page.waitForFunction(()=>window.LSEAdmin&&window.LSEConverter);
 const result=await page.evaluate(async()=>{
  const M=LSEConverter,request=LSEAdmin.request,pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';
  const plain={format:'little-studio-website',version:1,site_id:'large-import-regression',title:'Large import regression',site_css:'/*'+'s'.repeat(140*1024)+'*/',assets:[],fonts:[],pages:[{key:'large',title:'Large import regression',slug:'large-import-regression',url:'https://source.example/large/',parent_key:'',html:'<main><h1>Large stylesheet import</h1></main>',css:'/*'+'c'.repeat(4*1024*1024)+'*/',js:''}],site:{home_key:'large',navigation:[]}};
  const many=structuredClone(plain);many.pages.push(...Array.from({length:200},(_,i)=>({...plain.pages[0],key:'other-'+i,title:'Other '+i,css:''})));many.assets=Array.from({length:201},(_,i)=>({url:'https://source.example/asset-'+i+'.png',name:'asset-'+i+'.png',type:'image/png',data:'data:image/png;base64,'+pixel}));
  const validated=M.validate(many);if(validated.pages.length!==201||validated.assets.length!==201)throw Error('Import counts were clipped');
  const deep=structuredClone(plain);deep.site_css='';deep.pages[0].css='';deep.pages[0].html='<main>'+'<div>'.repeat(140)+'<h1>Deep heading</h1>'+'</div>'.repeat(140)+Array.from({length:4001},(_,i)=>'<p>Editable item '+i+'</p>').join('')+'</main>';
  const convertedMany=await M.convert(M.validate(deep),deep.pages[0],{map:{},preserveCSS:true,layout:'elementor_canvas'});if(convertedMany.counts.native<=4000)throw Error('Generated element count was clipped');
  const identity=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('large-import-'+LSE_CONFIG.version)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const job=await request('prepare',{fingerprint:identity,site_id:plain.site_id,title:plain.title,pages:plain.pages.map(({key,title,slug,url,parent_key})=>({key,title,slug,url,parent_key})),layout:'elementor_canvas',scripts:false,site:plain.site});
  const binary=atob(pixel),image=new Uint8Array(9*1024*1024);for(let i=0;i<binary.length;i++)image[i]=binary.charCodeAt(i);
  const media=await request('asset',{job:job.id,url:'https://source.example/large-image.png'},new File([image],'large-import-image.png',{type:'image/png'}));
  await request('test',{operation:'suite-media-only',id:media.id});
  const duplicate=await request('asset',{job:job.id,url:'https://source.example/suite-image.png'},new File([image],'suite-image.png',{type:'image/png'}));if(duplicate.id!==media.id||!duplicate.reused)throw Error('Suite media was duplicated');
  const elements=[{id:'aabb0001',elType:'widget',widgetType:'heading',settings:{title:'Large stylesheet import',header_size:'h1',_css_classes:'large-style-check'},elements:[]},{id:'aabb0002',elType:'widget',widgetType:'html',settings:{html:'<div style="display:none">'+'h'.repeat(600*1024)+'</div>'},elements:[]}];
  const source={html:plain.pages[0].html,css:plain.pages[0].css,js:''};
  let unsafeDenied=false;try{await request('page',{job:job.id,key:'large',elements,css:'body{background:url(javascript:evil)}',source,compact:true});}catch(e){unsafeDenied=/Unsafe CSS/.test(e.message);}if(!unsafeDenied)throw Error('CSS safety validation disappeared');
  const css='/*'+'r'.repeat(17*1024*1024)+'*/\n__LSE_SCOPE__ .large-style-check h1{color:rgb(13,79,131)}';
  const saved=await request('page',{job:job.id,key:'large',elements,css,source,compact:true});if(!saved.saved)throw Error('Large CSS was not saved');
  let ready;do{ready=await request('finish',{job:job.id});}while(ready.state==='finishing');
  const stats=await request('test',{operation:'large-stats',id:job.pages[0].id});if(stats.cssBytes<=16*1024*1024||stats.sourceBytes<=3*1024*1024||stats.settingsBytes<=512*1024)throw Error('Large content was truncated');
  return {job:ready,stats,validatedPages:validated.pages.length,validatedAssets:validated.assets.length,convertedNative:convertedMany.counts.native,largeMediaBytes:image.length,suiteMediaReused:true,unsafeCSSDenied:unsafeDenied};
 });
 await page.goto(result.job.pages[0].preview_url,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Large stylesheet import',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Large stylesheet import',exact:true}).evaluate(n=>getComputedStyle(n).color),'rgb(13, 79, 131)');
 await page.goto(process.env.LSE_TEST_URL+'/wp-admin/admin.php?page=little-studio-elementor');await page.waitForFunction(()=>window.LSEAdmin);await page.evaluate(job=>LSEAdmin.request('remove_import',{job:job.id,consent:true,expected_stamps:Object.fromEntries(job.pages.map(p=>[p.key,p.current_stamp]))}),result.job);
 delete result.job;console.log(JSON.stringify({largeImportRegression:true,renderedLargeStyles:true,...result}));
}finally{await browser.close();}
