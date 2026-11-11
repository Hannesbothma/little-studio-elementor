(()=>{'use strict';
 const config=window.LSE_CONFIG,M=window.LSEConverter,$=s=>document.querySelector(s),app=$('#lse-app');if(!app)return;
 let project=null,fingerprint='',job=null,busy=false,originalFile='',selectionStarted=false,pendingFingerprint='',lastError=null;
 const status = (message, error = false) => {
  for (const element of [$('#lse-status'), $('#lse-dialog-status')]) {
   element.textContent = message;
   element.classList.toggle('is-error', error);
   element.setAttribute('role', error ? 'alert' : 'status');
   element.setAttribute('aria-live', error ? 'assertive' : 'polite');
   element.hidden = !message;
  }
 };
 const step=i=>document.querySelectorAll('.lse-steps li').forEach((n,index)=>{if(index===i)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const actionNames={update_check:'Checking for a newer plugin version',update_install:'Updating the plugin',check:'Checking the WordPress connection',start:'Preparing new draft pages',asset:'Importing a file',page:'Saving a converted draft',finish:'Finishing the draft import',status:'Checking saved progress',undo:'Removing unchanged imported drafts',activate:'Applying optional homepage/menu settings',restore:'Restoring homepage/menu settings'};
 function responseData(res,text,details){
  const clean=text.replace(/^\uFEFF/,'').trim();let data;try{data=JSON.parse(clean);}catch{}
  // Accept a complete JSON confirmation after non-fatal PHP notices, never a login/block page.
  if(data===undefined){const marker=clean.search(/\{\s*"success"\s*:/);const prefix=marker>0?clean.slice(0,marker):'';if(marker>0&&/\b(?:Warning|Notice|Deprecated|Strict Standards)\b/i.test(prefix)&&!/<(?:html|form)\b|fatal error/i.test(prefix)){try{data=JSON.parse(clean.slice(marker));details.serverNotice=true;}catch{}}}
  if(res.ok&&data&&typeof data==='object'&&data.success===true&&Object.hasOwn(data,'data'))return data.data;
  let message;if(data&&typeof data==='object'&&data.success===false){message=typeof data.data?.message==='string'?data.data.message:typeof data.data==='string'?data.data:'';}else if(data&&typeof data.code==='string'&&typeof data.message==='string')message=data.message;
  if(!message){if(clean==='-1'||res.status===401||/wp-login\.php|id=["']loginform["']/i.test(clean))message='Your WordPress login expired. Reload the converter page and sign in if needed.';
   else if(clean==='0')message='WordPress did not recognise the import request. Reload the page and check that this plugin is active and you are signed in.';
   else if(res.status===413)message='The hosting server rejected the request because it is too large. Check the server request/upload limits.';
   else if(res.status===403)message='The server refused this save. Completed drafts are kept. Save the error details if retrying still fails.';
   else if(res.status>=500)message='WordPress or the hosting server could not complete this request. Check the PHP/server error log; some draft progress may already be saved.';
   else if(!clean)message='WordPress returned an empty response. Check saved import progress before retrying.';
   else if(/<!doctype|<html|<body|<form|<br\b/i.test(clean))message='WordPress returned an HTML page instead of the import confirmation. Check saved progress and the server/security log.';
   else message='WordPress returned an invalid import confirmation. Check saved progress before retrying.';}
  const error=Error((actionNames[details.action]||'WordPress request')+': '+message+' (HTTP '+res.status+').');error.lseMessage=message;error.lseDetails={...details,responseKind:data===undefined?(/<[^>]+>/.test(clean)?'html':'text'):'json'};throw error;
 }
 async function request(action,payload,file){
  const encoded=JSON.stringify(payload),bytes=new TextEncoder().encode(encoded).length;const files=Array.isArray(file)?file:(file?[file]:[]);
  const pageUpload=action==='page'&&['json-file-v1','json-gzip-v1'].includes(config.pageTransport);
  let upload=pageUpload?new Blob([encoded],{type:'application/json'}):null,compressed=false;
  if(pageUpload&&config.pageTransport==='json-gzip-v1'&&typeof CompressionStream==='function'){upload=await new Response(upload.stream().pipeThrough(new CompressionStream('gzip'))).blob();compressed=true;}
  const transferBytes=upload?.size||bytes;
  if(config.maxPost&&transferBytes+files.reduce((n,f)=>n+f.size,0)+16384>config.maxPost)throw Error('This request exceeds the server post_max_size limit. Increase it in your hosting settings and retry.');
  if(pageUpload&&config.maxUpload&&transferBytes>config.maxUpload)throw Error('The converted page exceeds the hosting upload limit. Increase it before retrying this saved import.');
  const form=new FormData();form.set('action','lse_'+action);form.set('nonce',config.nonce);
  if(pageUpload)form.set('payload_file',upload,compressed?'converted-page.json.gz':'converted-page.json');else form.set('payload',encoded);
  if(Array.isArray(file))files.forEach((item,index)=>form.set('file_'+index,item,item.name));else if(file)form.set('file',file,file.name);
  const controller=new AbortController(),timer=['check','status'].includes(action)?setTimeout(()=>controller.abort(),30000):null;
  let details={action,httpStatus:0,contentType:'',redirected:false,transport:pageUpload?(compressed?'gzip-file':'json-file'):'form-field',requestBytes:bytes,transferBytes};
  try{
   const target=pageUpload&&config.pageRest?config.pageRest:config.ajax;
   let res=await fetch(target,{method:'POST',credentials:'same-origin',headers:target===config.pageRest?{'X-WP-Nonce':config.restNonce}:{},body:form,signal:controller.signal});
   if(target===config.pageRest&&[403,404,405].includes(res.status)&&res.headers.get('x-little-studio-handler')!=='converter'){
    const failure=await res.clone().json().catch(()=>null);
    if(!failure||failure.code==='rest_no_route'){details.restFallback=true;res=await fetch(config.ajax,{method:'POST',credentials:'same-origin',body:form,signal:controller.signal});}
   }
   details={...details,httpStatus:res.status,contentType:res.headers.get('content-type')||'',redirected:res.redirected,requestId:res.headers.get('x-request-id')||res.headers.get('cf-ray')||'',converterHandler:res.headers.get('x-little-studio-handler')==='converter',serverOutputCleaned:res.headers.get('x-little-studio-output-cleaned')==='1'};
   return responseData(res,await res.text(),details);
  }catch(e){if(!e.lseDetails){e.lseDetails=details;if(e.name==='AbortError')e.message=(actionNames[action]||'WordPress request')+': confirmation timed out. Check saved import progress before retrying.';else if(e instanceof TypeError)e.message=(actionNames[action]||'WordPress request')+': the connection to WordPress failed. Reload the page and check your connection and WordPress address.';}throw e;}finally{clearTimeout(timer);}
 }
 function recordError(error,phase){lastError={plugin:'Little Studio to Elementor',version:config.version||'0.2.0',time:new Date().toISOString(),phase,sourceFile:originalFile,message:error.message,...(error.lseDetails||{})};$('#lse-error-details').hidden=false;}
 function setBusy(value){busy=value;for(const n of app.querySelectorAll('#lse-review input,#lse-review select,#lse-review button,#lse-file'))n.disabled=value||n.dataset.lseDisabled==='true';if(!config.canScripts)$('#lse-scripts').disabled=true;window.onbeforeunload=value?()=>true:null;window.dispatchEvent(new Event('lse:busy-changed'));}
 function selected(){const keys=new Set([...document.querySelectorAll('[data-page-key]:checked')].map(n=>n.dataset.pageKey));const chosen=project.pages.filter(p=>keys.has(p.key)).map(p=>({...p})),all=new Map(project.pages.map(p=>[p.key,p]));for(const p of chosen){let parent=p.parent_key;while(parent&&!keys.has(parent))parent=all.get(parent)?.parent_key||'';p.parent_key=parent;}return{...project,title:$('#lse-name').value.trim()||project.title||'Imported website',pages:chosen,site:{home_key:keys.has(project.site.home_key)?project.site.home_key:'',navigation:project.site.navigation.filter(n=>keys.has(n.key))}};}
 function refreshSelect(){const nodes=[...document.querySelectorAll('[data-page-key]')];const checked=nodes.filter(x=>x.checked).length;$('#lse-import').disabled=!checked||!config.elementor||busy;$('#lse-all').checked=checked===nodes.length;$('#lse-all').indeterminate=checked>0&&checked<nodes.length;}
 async function choose(file){if(busy||window.LSEManage?.busy||!file)return;setBusy(true);selectionStarted=true;job=null;pendingFingerprint='';lastError=null;$('#lse-error-details').hidden=true;$('#lse-check').hidden=true;try{if(!/\.(json|html?)$/i.test(file.name))throw Error('Choose one .json, .html or .htm file.');status('Reading and checking your website…');const text=await file.text();project=/\.html?$/i.test(file.name)?M.fromHTML(text,file.name):M.validate(JSON.parse(text.replace(/^\uFEFF/,'')));fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');originalFile=file.name;
  // Older native exports can omit navigation; recover known internal links, without inventing pages.
  if(!project.site.navigation.length){const d=new DOMParser().parseFromString(project.pages[0].html,'text/html');const seen=new Set();for(const a of d.querySelectorAll('nav a[href]')){const href=a.getAttribute('href');let found=project.pages.find(p=>p.url===href);try{const url=new URL(href,project.pages[0].url||'https://little-studio.invalid/');found=found||project.pages.find(p=>{try{return new URL(p.url).pathname===url.pathname;}catch{return false;}});}catch{}if(found&&!seen.has(found.key)&&a.textContent.trim()){project.site.navigation.push({key:found.key,label:a.textContent.trim().slice(0,150)});seen.add(found.key);}}}
  $('#lse-name').value=project.title||file.name.replace(/\.json$/i,'');$('#lse-summary').innerHTML=[project.pages.length+' pages',project.assets.length+' packaged files',project.fonts.length+' fonts',(project.assets.reduce((n,a)=>n+a.bytes.length,0)/1048576).toFixed(1)+' MB of assets'].map(x=>'<span>'+esc(x)+'</span>').join('');
  $('#lse-pages').innerHTML=project.pages.map(p=>{const x=M.inspect(p);return'<tr><td><input type="checkbox" checked data-page-key="'+esc(p.key)+'" aria-label="Import '+esc(p.title)+'"></td><td><strong>'+esc(p.title)+'</strong><small>'+x.headings+' headings · '+x.images+' images</small></td><td><small>'+esc(p.slug||p.key)+'</small></td><td><span class="lse-badge '+(x.warnings.length?'review':'')+'">'+(x.warnings.length?'Needs setup':'Ready')+'</span></td></tr>';}).join('');
  const captureWarnings=Array.isArray(project.capture?.warnings)?project.capture.warnings.filter(w=>typeof w==='string'):[];const findings=[...new Set([...captureWarnings,...project.pages.flatMap(p=>M.inspect(p).warnings)])];if(project.pages.some(p=>p.js.trim())&&!config.canScripts)findings.push('An administrator with script permission must import the interactive pages.');$('#lse-setup').hidden=!findings.length;$('#lse-findings').innerHTML=findings.length?'<ul>'+findings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>':'';const hasScripts=project.pages.some(p=>p.js.trim()||/<script/i.test(p.html));$('#lse-scripts').checked=hasScripts&&config.canScripts;$('#lse-scripts').closest('label').hidden=!hasScripts;$('#lse-review').hidden=false;$('#lse-choose').hidden=true;$('#lse-progress').hidden=true;step(1);refreshSelect();status('Website checked. Review the pages before continuing.');window.dispatchEvent(new Event('lse:file-selected'));
 }catch(e){project=null;$('#lse-file').value='';window.dispatchEvent(new Event('lse:file-error'));status(e.message||'The file could not be read.',true);}finally{setBusy(false);if(project)refreshSelect();}}
 function result(data){job=data;$('#lse-choose').hidden=true;$('#lse-progress').hidden=true;$('#lse-review').hidden=true;window.dispatchEvent(new CustomEvent('lse:import-saved',{detail:data}));status(data.state==='ready'?(data.refreshing?'Pages updated.':'Imported. Your pages are ready to edit.'):'Import progress loaded.');}
 async function run(){if(busy||!project)return;const source=selected();if(!source.pages.length)return;const target=window.LSEManage?.target;if(target&&$('#lse-overwrite').checked&&!confirm('Replace the content of '+source.pages.length+' selected existing pages? Edited or published content may change immediately. Their IDs, addresses and publication status stay the same.'))return;setBusy(true);$('#lse-progress').hidden=false;$('#lse-review').hidden=true;$('#lse-retry').hidden=true;$('#lse-cancel').hidden=true;step(2);window.dispatchEvent(new Event('lse:import-started'));const progress=(n,message)=>{$('#lse-meter').value=n;$('#lse-current').textContent=message;status(message);};try{
  for(const a of source.assets)if(a.bytes.length>config.maxUpload)throw Error(a.name+' exceeds this server’s upload limit. Increase the hosting limit before importing.');progress(1,'Preparing your website drafts…');const optionKey=fingerprint+':'+(config.conversionVersion||'legacy')+':'+source.title+':'+source.pages.map(p=>p.key).join(',')+':'+$('#lse-layout').value+':'+$('#lse-css').checked+':'+$('#lse-scripts').checked+':'+(target?.id||'new');const importIdentity=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(optionKey)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  pendingFingerprint=importIdentity;$('#lse-check').hidden=true;progress(1,'Preparing your protected WordPress drafts…');job=await request('prepare',{fingerprint:importIdentity,site_id:source.site_id,target_job:target?.id||'',expected_stamps:target?Object.fromEntries(target.pages.map(p=>[p.key,p.current_stamp])):{},overwrite:$('#lse-overwrite').checked,title:source.title,pages:source.pages.map(({key,title,slug,url,parent_key})=>({key,title,slug,url,parent_key})),site:source.site,layout:$('#lse-layout').value,scripts:$('#lse-scripts').checked});if(job.state==='ready'){result(job);return;}if(job.state==='interrupted'||(!target&&job.pages.length!==source.pages.length)||job.pages.some(p=>!p.url||!p.edit_url))throw Error('Draft preparation stopped early. Remove this import’s unchanged drafts before starting it again.');
  const imageAlt=new Map(),fontFamilies=new Map();for(const page of source.pages){const doc=new DOMParser().parseFromString(page.html,'text/html');for(const img of doc.images)if(!imageAlt.has(img.getAttribute('src')))imageAlt.set(img.getAttribute('src'),img.getAttribute('alt')||'');}for(const font of source.fonts){if(!fontFamilies.has(font.url))fontFamilies.set(font.url,[]);fontFamilies.get(font.url).push(font.family);}
  const uploadName=asset=>{if(!/^(?:(?:(?:captured|embedded)-)?(?:[a-f0-9]{16,64}|[0-9]+)|(?:img|dsc|image|photo|picture|asset)[-_ .\d]+)\.[a-z0-9]+$/i.test(asset.name))return asset.name;const extension=asset.name.split('.').pop();const label=(imageAlt.get(asset.url)||fontFamilies.get(asset.url)?.[0]||source.title+' '+asset.type.split('/')[0]).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,76).replace(/-+$/,'')||'website-media';return label+'.'+extension;};
  const pendingAssets=source.assets.filter(asset=>!job.assets.some(a=>a.source===asset.url));const maxBatch=Math.max(1,config.mediaBatchSize||4);let uploaded=0,uploadBatchSize=maxBatch,fastGroups=0;
  const batchLimit=Math.max(1,Math.min(4*1048576,(config.maxPost||Infinity)-16384));
  const inputsByURL=new Map(pendingAssets.map(asset=>[asset.url,{url:asset.url,families:fontFamilies.get(asset.url)||[],alt:imageAlt.get(asset.url)||''}]));const metadataBytes=new Map([...inputsByURL].map(([url,input])=>[url,new TextEncoder().encode(JSON.stringify(input)).length]));
  for(let i=0;i<pendingAssets.length;){const group=[];let size=0,metadata=128;while(i<pendingAssets.length&&group.length<uploadBatchSize){const asset=pendingAssets[i],nextMetadata=metadata+metadataBytes.get(asset.url)+1;if(group.length&&(size+asset.bytes.length>batchLimit||(config.maxPost&&size+asset.bytes.length+nextMetadata+16384>config.maxPost)))break;group.push(asset);size+=asset.bytes.length;metadata=nextMetadata;i++;if(size>batchLimit)break;}
   progress(5+35*uploaded/Math.max(1,pendingAssets.length),'Importing files '+(uploaded+1)+'–'+(uploaded+group.length)+' of '+pendingAssets.length+'…');
   const inputs=group.map(asset=>inputsByURL.get(asset.url));const files=group.map(asset=>new File([asset.bytes],uploadName(asset),{type:asset.type}));
   let completed=1,savedAssets=[];if(group.length===1)savedAssets=[await request('asset',{job:job.id,...inputs[0]},files[0])];else{const response=await request('assets',{job:job.id,assets:inputs},files);savedAssets=response.assets||[];completed=response.assets?.length||0;if(completed<1||completed>group.length)throw Error('Media batch progress was not confirmed. Retry the saved import.');if(completed<group.length){uploadBatchSize=completed;fastGroups=0;}}if(completed===group.length&&savedAssets.every(a=>Number.isFinite(a.processing_ms)&&a.processing_ms<250)){if(++fastGroups>=2){uploadBatchSize=Math.min(maxBatch,uploadBatchSize*2);fastGroups=0;}}else fastGroups=0;for(const saved of savedAssets){job.map[saved.source]=saved.url;if(!job.assets.some(a=>a.source===saved.source))job.assets.push(saved);}i-=group.length-completed;uploaded+=completed;
  }
  const pendingPages=source.pages.filter(page=>!job.pages.find(p=>p.key===page.key)?.done);
  const prepare=page=>M.convert(source,page,{map:job.map,layout:job.layout,preserveCSS:$('#lse-css').checked}).then(value=>({value}),error=>({error}));
  let prepared=pendingPages.length?prepare(pendingPages[0]):null;
  for(let i=0;i<pendingPages.length;i++){const page=pendingPages[i];progress(40+55*i/Math.max(1,pendingPages.length),'Converting and saving page '+(i+1)+' of '+pendingPages.length+': '+page.title);const converted=await prepared;if(converted.error)throw converted.error;
   const saving=request('page',{job:job.id,key:page.key,...converted.value,compact:true});prepared=i+1<pendingPages.length?prepare(pendingPages[i+1]):null;
   const saved=await saving;if(!saved.saved||saved.key!==page.key)throw Error('The page save was not confirmed. Check saved progress before retrying.');const entry=job.pages.find(p=>p.key===page.key);entry.done=true;entry.stamp=saved.stamp;
  }
  progress(98,'Checking pages and preparing shared sections and navigation…');do{job=await request('finish',{job:job.id});}while(job.state==='finishing');progress(100,'Website import complete.');result(job);
 }catch(e){const phase=$('#lse-current').textContent;recordError(e,phase);$('#lse-retry').hidden=false;$('#lse-cancel').hidden=!job;$('#lse-check').hidden=!pendingFingerprint;status(e.message,true);$('#lse-current').textContent='Import paused. Check saved progress before continuing. Completed drafts and uploaded files are kept.';}finally{setBusy(false);}}
 $('#lse-file').addEventListener('change',e=>choose(e.target.files[0]));const drop=$('.lse-drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('is-over');});drop.addEventListener('dragleave',()=>drop.classList.remove('is-over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('is-over');if(e.dataTransfer.files.length!==1){status('Drop one complete website JSON file.',true);return;}choose(e.dataTransfer.files[0]);});
 $('#lse-all').addEventListener('change',e=>{document.querySelectorAll('[data-page-key]:not(:disabled)').forEach(n=>n.checked=e.target.checked);refreshSelect();});$('#lse-pages').addEventListener('change',refreshSelect);$('#lse-import').addEventListener('click',run);$('#lse-retry').addEventListener('click',run);
 $('#lse-reset').addEventListener('click',()=>{if(busy)return;project=null;$('#lse-file').value='';$('#lse-review').hidden=true;$('#lse-choose').hidden=false;step(0);status('Choose a JSON or HTML file.');window.dispatchEvent(new Event('lse:choose-reset'));});
 $('#lse-download').addEventListener('click',()=>{if(!job)return;const blob=new Blob([JSON.stringify({plugin:'Little Studio to Elementor',version:config.version||'0.2.0',source:originalFile,...job},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='little-studio-elementor-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
 $('#lse-cancel').addEventListener('click',()=>window.LSEManage?.remove(job));
 $('#lse-check').addEventListener('click',async()=>{
  const feedback=(message,error=false)=>{$('#lse-current').textContent=message;status(message,error);};
  if(busy){feedback('An import request is still running. Wait for it to finish before checking saved progress.');return;}
  if(!pendingFingerprint&&!job?.id){feedback('Choose the same JSON file and options first so saved progress can be matched.');return;}
  const button=$('#lse-check'),label=button.textContent;button.disabled=true;button.textContent='Checking saved progress…';feedback('Checking saved import progress…');
  try{
   job=pendingFingerprint?(await request('check',{fingerprint:pendingFingerprint})).import:await request('status',{job:job.id});
   $('#lse-cancel').hidden=!job;
   if(!job){feedback('No saved import matches this file and these options. Retry can prepare new drafts.');return;}
   if(job.state==='ready'){result(job);return;}
   feedback('Saved progress: '+job.pages.length+' drafts prepared, '+job.pages.filter(p=>p.done).length+' converted, '+job.assets.length+' files imported. Continue with the same file and options.');
  }catch(e){recordError(e,'Checking saved import progress');feedback(e.message,true);}finally{button.disabled=false;button.textContent=label;}
 });
 $('#lse-error-details').addEventListener('click',()=>{if(!lastError)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastError,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='little-studio-import-error.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 async function siteSetup(action) {
  if (busy || window.LSEManage?.busy || !job) return;
  setBusy(true);
  try {
   job = await request(action, {job: job.id, consent: $('#lse-activate-consent').checked});
   window.dispatchEvent(new CustomEvent('lse:import-saved', {detail: job}));
   status(action === 'activate' ? 'Reviewed homepage and menu setup applied.' : 'Site setup recovery checked.');
  } catch (error) {
   status(error.message, true);
  } finally {
   setBusy(false);
  }
 }
 $('#lse-activate').addEventListener('click', () => siteSetup('activate'));
 $('#lse-restore').addEventListener('click', () => siteSetup('restore'));
 if(!config.canScripts){$('#lse-scripts').disabled=true;$('#lse-scripts').parentElement.title='Your account cannot run unfiltered JavaScript.';}
 window.LSEAdmin={request,choose,run,setJob(data){job=data;selectionStarted=true;},get busy(){return busy;},get project(){return project;},get job(){return job;}};
 if(config.lastJob)request('status',{job:config.lastJob}).then(data=>{if(selectionStarted||busy)return;if(data.engine!==config.conversionVersion){status('Choose your website JSON to rebuild working drafts with this converter. Existing pages are kept.');return;}if(['ready','interrupted'].includes(data.state))result(data);else if(['importing','finishing'].includes(data.state)){job=data;$('#lse-progress').hidden=false;$('#lse-cancel').hidden=false;status('An earlier import is unfinished. Choose the same JSON and options to continue it, or remove its unedited drafts.');window.dispatchEvent(new Event('lse:resume-progress'));}}).catch(()=>{});
})();
