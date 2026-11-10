(() => {
 'use strict';
 const A=window.LSEAdmin,$=s=>document.querySelector(s),M=window.LSEConverter;
 if(!A||!$('#lse-managed'))return;
 let imports=[],next=null,current=null,target=null,loading=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const message=(text,error=false)=>{const el=$('#lse-manage-message');el.textContent=text;el.classList.toggle('is-error',error)};
 async function list(more=false){
  const data=await A.request('imports',{offset:more?next||0:0});
  imports=more?imports.concat(data.imports):data.imports;next=data.next;
  const selected=current?.id||$('#lse-import-list').value;
  $('#lse-import-list').innerHTML='<option value="">Choose an imported website</option>'+imports.map(j=>'<option value="'+esc(j.id)+'">'+esc(j.title)+' · '+j.pages+' pages</option>').join('');
  $('#lse-import-list').value=selected;$('#lse-more-imports').hidden=next===null;
 }
 function render(){
  $('#lse-refresh-import').disabled=!current||['importing','finishing'].includes(current.state);
  if(!current){$('#lse-managed-pages').replaceChildren();return}
  $('#lse-managed-pages').innerHTML='<div class="lse-table-scroll"><table class="widefat striped lse-managed-table"><thead><tr><th>Page title and address</th><th>State</th><th>Actions</th></tr></thead><tbody>'+current.pages.map(p=>'<tr data-managed-key="'+esc(p.key)+'"><td><label>Title<input data-field="title" value="'+esc(p.current_title)+'" aria-label="Page title"></label><label>Address<input data-field="slug" value="'+esc(p.slug)+'" aria-label="Page address"></label></td><td>'+esc(p.post_status)+(p.changed?'<br><small>Edited since import</small>':'')+'</td><td><div class="lse-page-actions">'+(p.can_edit&&p.post_status!=='trash'?'<a class="button" href="'+esc(p.edit_url)+'">Edit with Elementor</a><a class="button" target="_blank" rel="noopener" href="'+esc(p.preview_url)+'">Preview</a><button type="button" class="button" data-operation="metadata">Save details</button>':'')+(p.can_delete?'<button type="button" class="button" data-operation="'+(p.post_status==='trash'?'untrash':'trash')+'">'+(p.post_status==='trash'?'Restore draft':'Move to Trash')+'</button>':'')+(p.can_restore_refresh?'<button type="button" class="button" data-operation="restore_refresh">Restore before last refresh</button>':'')+'</div></td></tr>').join('')+'</tbody></table></div>';
 }
 async function select(id){
  if(A.busy||loading)return;loading=true;
  try{current=id?await A.request('status',{job:id}):null;render();message(current?'Loaded existing pages. Editing opens their current Elementor content.':'Choose an imported website.');}
  catch(e){message(e.message,true)}finally{loading=false}
 }
 $('#lse-import-list').addEventListener('change',e=>select(e.target.value));
 $('#lse-reload-imports').onclick=async()=>{if(A.busy||loading)return;try{await list();if(current)await select(current.id);else message('Imported websites reloaded.')}catch(e){message(e.message,true)}};
 $('#lse-more-imports').onclick=()=>list(true).catch(e=>message(e.message,true));
 $('#lse-managed-pages').onclick=async event=>{
  const button=event.target.closest('button[data-operation]');if(!button||A.busy||loading||!current)return;
  const row=button.closest('[data-managed-key]'),page=current.pages.find(p=>p.key===row.dataset.managedKey),operation=button.dataset.operation;
  if(operation==='trash'&&!confirm('Move “'+page.current_title+'” ('+page.post_status+') to WordPress Trash? This also removes a published page from the live site. Media files are kept.'))return;
  if(operation==='restore_refresh'&&!confirm('Restore “'+page.current_title+'” to its content before the last refresh? Its publication status stays unchanged.'))return;
  loading=true;button.disabled=true;
  try{current=await A.request(operation==='restore_refresh'?'restore_refresh':'manage_page',{job:current.id,key:page.key,operation,expected_stamp:page.current_stamp,title:row.querySelector('[data-field="title"]').value,slug:row.querySelector('[data-field="slug"]').value,consent:true});render();message(operation==='metadata'?'Page details saved.':operation==='trash'?'Page moved to Trash.':operation==='restore_refresh'?'Content before the last refresh restored.':'Page restored. Review it before publishing.');}
  catch(e){message(e.message,true)}finally{loading=false;button.disabled=false}
 };
 $('#lse-refresh-import').onclick=async()=>{
  if(!current||A.busy||loading)return;
  try{target=await A.request('status',{job:current.id});$('#lse-reset').click();$('#lse-file').click();message('Choose the updated JSON or HTML for '+target.title+'. Existing page IDs and addresses will be kept.');}
  catch(e){message(e.message,true)}
 };
 function review(project){
  const context=$('#lse-refresh-context'),overwrite=$('#lse-overwrite-option');
  context.hidden=!target;overwrite.hidden=!target;$('#lse-overwrite').checked=false;
  $('#lse-import').textContent=target?'Refresh selected existing pages':'Import website as drafts';$('#lse-import-scope').textContent=target?'Selected existing pages are replaced after your confirmation.':'New imports add drafts. Nothing is published.';
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
 window.addEventListener('lse:file-selected',()=>review(A.project));
 window.addEventListener('lse:import-saved',async e=>{current=e.detail;target=null;$('#lse-layout').disabled=false;delete $('#lse-layout').dataset.lseDisabled;render();try{await list()}catch(e){message(e.message,true)}});
 window.LSEManage={get target(){return target},review,clear(){target=null;$('#lse-layout').disabled=false;delete $('#lse-layout').dataset.lseDisabled},async reload(){await list();if(current)await select(current.id)}};
 list().catch(e=>message(e.message,true));
})();
