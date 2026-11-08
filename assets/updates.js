(()=>{'use strict';
 const check=document.querySelector('#lse-update-check'),install=document.querySelector('#lse-update-now'),message=document.querySelector('#lse-update-message');if(!check||!window.LSEAdmin)return;
 let working=false;
 function show(state){install.hidden=!state.available;message.textContent=state.available?'Installed '+state.installed+' · New version '+state.latest+' is available.':state.latest?'You have the newest version ('+state.installed+').':'Installed '+state.installed+'.';message.setAttribute('role','status');}
 async function request(update){if(working)return;if(update&&LSEAdmin.busy){message.textContent='Finish or pause the current import before updating the plugin.';return;}working=true;check.disabled=true;install.disabled=true;message.textContent=update?'Updating the plugin…':'Looking for the newest update…';try{const state=await LSEAdmin.request(update?'update_install':'update_check',{force:true});show(state);if(state.updated){message.textContent='Update complete. Reloading…';window.location.reload();}}catch(error){install.hidden=true;message.textContent=error.lseMessage||error.message;message.setAttribute('role','alert');}finally{working=false;check.disabled=false;install.disabled=false;}}
 show(window.LSE_UPDATE_STATE||{});check.addEventListener('click',()=>request(false));install.addEventListener('click',()=>request(true));
})();
