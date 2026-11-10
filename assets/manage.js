(() => {
 'use strict';
 const A=window.LSEAdmin,$=s=>document.querySelector(s);
 if(!A||!$('#lse-managed'))return;
 let imports=[],next=null,current=null,target=null,loading=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const message=(text,error=false)=>{const el=$('#lse-manage-message');el.textContent=text;el.classList.toggle('is-error',error)};
 function view(mode){
  for(const [id,show] of [['lse-choose','choose'],['lse-review','review'],['lse-progress','progress'],['lse-managed-pages','manage'],['lse-import-actions','manage'],['lse-import-details','manage']])$('#'+id).hidden=mode!==show;
  $('#lse-managed').dataset.mode=mode;
 }
 async function list(more=false){
  const data=await A.request('imports',{offset:more?next||0:0});imports=more?imports.concat(data.imports):data.imports;next=data.next;
  $('#lse-import-list').innerHTML='<option value="">New import</option>'+imports.map(j=>'<option value="'+esc(j.id)+'">'+esc(j.title)+'</option>').join('');
  $('#lse-import-list').value=current?.id||'';$('#lse-more-imports').hidden=next===null;
 }
 function render(){
  A.setJob(current);
  if(!current){view('choose');$('#lse-managed-pages').replaceChildren();return}
  view('manage');$('#lse-import-list').value=current.id;
  $('#lse-refresh-import').disabled=['importing','finishing'].includes(current.state);
  $('#lse-managed-pages').innerHTML='<div class="lse-table-scroll"><table class="widefat striped lse-managed-table"><thead><tr><th>Page</th><th>Status</th><th></th></tr></thead><tbody>'+current.pages.map(p=>'<tr data-managed-key="'+esc(p.key)+'"><td><strong>'+esc(p.current_title)+'</strong><small>'+esc(p.slug)+'</small></td><td>'+esc(p.post_status==='publish'?'Published':p.post_status==='trash'?'In Trash':p.post_status)+'</td><td><div class="lse-page-actions">'+(p.can_edit&&p.post_status!=='trash'?'<a class="button" href="'+esc(p.edit_url)+'">Edit in Elementor</a><a target="_blank" rel="noopener" href="'+esc(p.preview_url)+'">Preview</a>':'')+(p.can_edit?'<details class="lse-page-more"><summary>More</summary><div class="lse-page-menu">'+(p.post_status!=='trash'?'<label>Title<input data-field="title" value="'+esc(p.current_title)+'"></label><label>Address<input data-field="slug" value="'+esc(p.slug)+'"></label><button type="button" class="button" data-operation="metadata">Save details</button>':'')+(p.can_delete?'<button type="button" class="button" data-operation="'+(p.post_status==='trash'?'untrash':'trash')+'">'+(p.post_status==='trash'?'Restore draft':'Move to Trash')+'</button>':'')+(p.can_restore_refresh?'<button type="button" class="button" data-operation="restore_refresh">Restore before last update</button>':'')+'</div></details>':'')+'</div></td></tr>').join('')+'</tbody></table></div>';
  const templates=Object.values(current.templates||{});
  $('#lse-report').innerHTML='<p>'+current.pages.length+' pages · '+current.assets.length+' media files</p>'+templates.map(t=>'<p><a href="'+esc(t.edit_url)+'">Edit shared '+esc(t.kind)+'</a></p>').join('')+Object.entries(current.reports||{}).map(([key,r])=>'<p><strong>'+esc(current.pages.find(p=>p.key===key)?.current_title||key)+'</strong>: '+r.native+' native elements, '+r.fallbacks+' HTML regions.</p>'+(r.warnings.length?'<ul>'+r.warnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>':'')).join('');
  $('#lse-restore').hidden=!current.activated;$('#lse-restoration').textContent=(current.restoration||[]).join(' ');
 }
 async function select(id){
  if(A.busy||loading)return;loading=true;
  try{clearTarget();current=id?await A.request('status',{job:id}):null;render();message('');}
  catch(e){message(e.message,true)}finally{loading=false}
 }
 function clearTarget(){target=null;$('#lse-layout').disabled=false;delete $('#lse-layout').dataset.lseDisabled;}
 async function remove(imported=current){
  if(!imported||A.busy||loading)return;loading=true;
  try{
   const latest=await A.request('status',{job:imported.id}),published=latest.pages.filter(p=>p.post_status==='publish').length;
   if(!confirm('Remove “'+latest.title+'” and all '+latest.pages.length+' pages'+(published?' ('+published+' published)':'')+' from this site? Pages go to WordPress Trash. Media files are kept.'))return;
   const result=await A.request('remove_import',{job:latest.id,expected_stamps:Object.fromEntries(latest.pages.map(p=>[p.key,p.current_stamp])),consent:true});
   clearTarget();current=result.state==='removed'?null:result;render();await list();
   message(result.state==='removed'?'Import removed. Pages are in WordPress Trash; media files were kept.':'Some pages could not be removed. Review the import and try again.',result.state!=='removed');
  }catch(e){message(e.message,true)}finally{loading=false}
 }
 $('#lse-import-list').addEventListener('change',e=>select(e.target.value));
 $('#lse-new-import').onclick=()=>{if(A.busy||loading)return;current=null;clearTarget();$('#lse-import-list').value='';render();$('#lse-reset').click();$('#lse-file').click();};
 $('#lse-more-imports').onclick=()=>list(true).catch(e=>message(e.message,true));
 $('#lse-remove-import').onclick=()=>remove();
 $('#lse-managed-pages').onclick=async event=>{
  const button=event.target.closest('button[data-operation]');if(!button||A.busy||loading||!current)return;
  const row=button.closest('[data-managed-key]'),page=current.pages.find(p=>p.key===row.dataset.managedKey),operation=button.dataset.operation;
  if(operation==='trash'&&!confirm('Move “'+page.current_title+'” to WordPress Trash? A published page will disappear from the site.'))return;
  if(operation==='restore_refresh'&&!confirm('Restore “'+page.current_title+'” to its content before the last update?'))return;
  loading=true;button.disabled=true;
  try{current=await A.request(operation==='restore_refresh'?'restore_refresh':'manage_page',{job:current.id,key:page.key,operation,expected_stamp:page.current_stamp,title:row.querySelector('[data-field="title"]')?.value||'',slug:row.querySelector('[data-field="slug"]')?.value||'',consent:true});render();message(operation==='metadata'?'Saved.':operation==='trash'?'Page moved to Trash.':'Page restored.');}
  catch(e){message(e.message,true)}finally{loading=false;button.disabled=false}
 };
 $('#lse-refresh-import').onclick=async()=>{
  if(!current||A.busy||loading)return;
  try{$('#lse-reset').click();target=await A.request('status',{job:current.id});$('#lse-file').click();message('');}
  catch(e){message(e.message,true)}
 };
 function review(project){
  const context=$('#lse-refresh-context'),overwrite=$('#lse-overwrite-option');
  context.hidden=!target;overwrite.hidden=!target;$('#lse-overwrite').checked=false;
  $('#lse-import').textContent=target?'Update selected pages':'Import';$('#lse-import-scope').textContent=target?'Selected existing pages are replaced after your confirmation.':'New imports add drafts. Nothing is published.';
  if(!target)return;
  context.textContent='Refreshing '+target.title+'. Existing page IDs, addresses and publication status are kept. Pages absent from this file stay unchanged.';
  if(project.input_kind==='html'){
   const label=document.createElement('label'),select=document.createElement('select');label.textContent=' Replace this imported page: ';
   for(const page of target.pages.filter(p=>!['trash','missing'].includes(p.post_status))){const option=document.createElement('option');option.value=page.key;option.textContent=page.current_title;select.append(option)}
   select.value=project.htmlDestination||select.options[0]?.value||'';
   const remap=()=>{const key=select.value;project.htmlDestination=key;project.pages[0].key=key;project.site.home_key=key;project.site_id=target.site_id||project.site_id;document.querySelector('[data-page-key]')?.setAttribute('data-page-key',key)};
   remap();select.onchange=()=>{remap();review(project)};label.append(select);context.append(label);
  }
  $('#lse-layout').value=target.layout;$('#lse-layout').disabled=true;$('#lse-layout').dataset.lseDisabled='true';
  for(const checkbox of document.querySelectorAll('[data-page-key]')){
   const page=target.pages.find(p=>p.key===checkbox.dataset.pageKey);
   const valid=page&&!['trash','missing'].includes(page.post_status);
   checkbox.disabled=!valid;checkbox.dataset.lseDisabled=String(!valid);checkbox.checked=!!valid&&!page.changed&&page.post_status==='draft';
   const row=checkbox.closest('tr');row.querySelector('td:last-child').textContent=!page?'New page — import separately':page.post_status==='trash'?'Restore before refreshing':page.changed||page.post_status!=='draft'?'Edited / '+page.post_status+' — replacement requires consent':'Ready to refresh';
  }
  $('#lse-pages').dispatchEvent(new Event('change'));
 }
 window.addEventListener('lse:file-selected',()=>{view('review');review(A.project)});
 window.addEventListener('lse:import-started',()=>{view('progress');message('')});
 window.addEventListener('lse:choose-reset',()=>{clearTarget();render();message('')});
 window.addEventListener('lse:import-saved',async e=>{current=e.detail;clearTarget();render();message('');try{await list()}catch(e){message(e.message,true)}});
 window.LSEManage={get target(){return target},get current(){return current},review,remove,clear:clearTarget,async reload(){await list();if(current)await select(current.id)}};
 list().catch(e=>message(e.message,true));
})();
