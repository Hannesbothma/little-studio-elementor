(() => {
 'use strict';
 const A = window.LSEAdmin, M = window.LSEConverter, $ = s => document.querySelector(s);
 const bytes = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));
 const text = record => new TextDecoder().decode(bytes(record.data));
 const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(n => n.toString(16).padStart(2, '0')).join('');
 const encoder = new TextEncoder();
 const absolute = (value, base) => { if (!value || !value.trim()) return ''; try { const u = new URL(value, base); if (!/^https?:$/.test(u.protocol) || u.username || u.password) return ''; u.hash = ''; return u.href; } catch { return ''; } };
 const mediaType = (record, url) => {
  const aliases = {'image/jpg':'image/jpeg', 'application/font-woff':'font/woff', 'application/x-font-woff':'font/woff', 'application/font-woff2':'font/woff2', 'application/x-font-ttf':'font/ttf', 'application/x-font-opentype':'font/otf', 'application/vnd.ms-fontobject':''};
  let type = aliases[record.type] ?? record.type;
  if (type === 'application/octet-stream') type = ({woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav'})[new URL(url).pathname.split('.').pop().toLowerCase()] || type;
  return /^(?:image\/(?:jpeg|png|gif|webp|avif|svg\+xml)|font\/(?:woff2?|ttf|otf)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|ogg))$/.test(type) ? type : '';
 };
 async function packageWebsite(source, records, warnings = []) {
  source = absolute(source, source);
  const resources = new Map(), assets = [], assetMap = new Map(), byHash = new Map(), notes = new Set(warnings);
  for (const r of records) { resources.set(r.url, r); resources.set(r.requested, r); }
  const pages = [...new Map(records.filter(r => r.kind === 'page' && r.type === 'text/html').map(r => [r.url, r])).values()];
  if (!pages.length) throw Error('No HTML pages were captured. Try Desktop capture for this website.');
  let assetBytes = 0;
  const asset = async (value, base) => {
   if (!value || value.startsWith('#')) return value;
   if (value.startsWith('data:')) return value; // Native validation safely packages embedded media.
   const url = absolute(value, base);
   if (!url) return '';
   const fragment = new URL(value, base).hash;
   if (assets.some(a => a.url === url)) return url + fragment;
   if (assetMap.has(url)) return assetMap.get(url) + fragment;
   const record = resources.get(url), type = record && mediaType(record, url);
   if (!record || !type) { notes.add('External file needs review: ' + url); return url + fragment; }
   const body = bytes(record.data), digest = await hash(body);
   if (type === 'image/svg+xml' && /<!DOCTYPE|<!ENTITY/i.test(text(record))) { notes.add('An SVG with document declarations was left external: ' + url); return url; }
   if (byHash.has(type + digest)) { const existing = byHash.get(type + digest); assetMap.set(url, existing); return existing + fragment; }
   if (body.length > 8 * 1048576 || assetBytes + body.length > 32 * 1048576 || assets.length >= 200) throw Error('Packaged media exceeds the import limit. Reduce the page count.');
   const ext = ({'image/jpeg':'jpg','image/svg+xml':'svg','audio/mpeg':'mp3'})[type] || type.split('/')[1];
   const packaged = 'https://little-studio-assets.invalid/capture/' + digest + '.' + ext;
   assets.push({url:packaged, name:digest.slice(0,20) + '.' + ext, type, data:'data:' + type + ';base64,' + record.data});
   assetBytes += body.length; assetMap.set(url, packaged); byHash.set(type + digest, packaged); return packaged + fragment;
  };
  const replaceAsync = async (input, pattern, fn) => { const matches = [...input.matchAll(pattern)], values = await Promise.all(matches.map(fn)); let index = 0; return input.replace(pattern, () => values[index++]); };
  const css = async (input, base, stack = []) => {
   input = await replaceAsync(input, /@import\s+(?:url\(\s*['"]?([^'"\)]+)['"]?\s*\)|['"]([^'"]+)['"])\s*([^;]*);/gi, async m => {
    const url = absolute(m[1] || m[2], base), record = resources.get(url);
    if (!record || record.type !== 'text/css' || stack.includes(url) || stack.length > 12) { notes.add('A stylesheet import needs review: ' + (url || base)); return ''; }
    const imported = await css(text(record), record.url, [...stack, url]), condition = m[3].trim();
    if (/^(?:layer|supports)\b/.test(condition)) { notes.add('A CSS layer or supports import was flattened; review its appearance.'); return imported; }
    return condition ? '@media ' + condition + '{' + imported + '}' : imported;
   });
   return replaceAsync(input, /url\(\s*(['"]?)(.*?)\1\s*\)/gi, async m => 'url("' + (await asset(m[2], base)).replaceAll('"','%22') + '")');
  };
  const output = [], navigation = [], documents = new Map();
  for (const record of pages) {
   const doc = new DOMParser().parseFromString(text(record), 'text/html');
   const base = absolute(doc.querySelector('base[href]')?.getAttribute('href') || record.url, record.url) || record.url;
   documents.set(record.url, {doc, base});
   const key = 'page-' + (await hash(encoder.encode(record.url))).slice(0,20);
   const styles = [], scripts = [];
   for (const node of [...doc.querySelectorAll('style,link[rel~="stylesheet"]')]) {
    if (node.tagName === 'STYLE') { const content = await css(node.textContent, base); styles.push(node.media && node.media !== 'all' ? '@media ' + node.media + '{' + content + '}' : content); }
    else { const url = absolute(node.getAttribute('href'), base), sheet = resources.get(url); if (sheet?.type === 'text/css') { const content = await css(text(sheet), sheet.url, [url]); styles.push(node.media && node.media !== 'all' ? '@media ' + node.media + '{' + content + '}' : content); } else notes.add('A stylesheet could not be packaged: ' + url); }
    node.remove();
   }
   for (const script of [...doc.querySelectorAll('script')]) {
    const type = script.getAttribute('type') || '';
    if (!type || /^(?:text|application)\/(?:java|ecma)script$/i.test(type)) {
     if (script.src) { const url = absolute(script.getAttribute('src'), base), code = resources.get(url); if (code) scripts.push(text(code)); else notes.add('A script could not be packaged: ' + url); }
     else scripts.push(script.textContent);
    } else if (type === 'module') notes.add('This site uses JavaScript modules. App behavior needs manual rebuilding.');
    script.remove();
   }
   for (const node of doc.querySelectorAll('base,meta[http-equiv]')) node.remove();
   for (const el of doc.querySelectorAll('*')) {
    if (el.hasAttribute('style')) el.setAttribute('style', await css(el.getAttribute('style'), base));
    for (const attr of ['src','poster','data-src','data-lazy-src','data-original']) {
     if (!el.hasAttribute(attr)) continue;
     if (['IMG','SOURCE','VIDEO','AUDIO','INPUT'].includes(el.tagName)) el.setAttribute(attr, await asset(el.getAttribute(attr), base));
     else { const url = absolute(el.getAttribute(attr), base); if (url) el.setAttribute(attr, url); else el.removeAttribute(attr); }
    }
    if (el.tagName === 'IMG' && !el.getAttribute('src')) { const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original'); if (lazy) el.setAttribute('src', lazy); }
    for (const attr of ['srcset','data-srcset']) if (el.hasAttribute(attr) && !el.getAttribute(attr).includes('data:')) {
     const candidates = []; for (const candidate of el.getAttribute(attr).split(',')) { const [url,...descriptor] = candidate.trim().split(/\s+/); if (url) candidates.push([await asset(url, base),...descriptor].join(' ')); } el.setAttribute(attr, candidates.join(', '));
    }
    if (['use','image'].includes(el.tagName.toLowerCase())) for (const attr of ['href','xlink:href']) if (el.hasAttribute(attr)) el.setAttribute(attr, await asset(el.getAttribute(attr), base));
    for (const attr of ['href','action']) if (el.hasAttribute(attr)) {
     if (['use','image'].includes(el.tagName.toLowerCase())) continue;
     const value = el.getAttribute(attr);
     if (/^(?:#|mailto:|tel:)/i.test(value)) continue;
     const url = absolute(value, base); if (url) { const original = resources.get(url)?.url || url; let fragment = ''; try { fragment = new URL(value, base).hash; } catch {} el.setAttribute(attr, original + fragment); } else el.removeAttribute(attr);
    }
   }
   const title = (doc.title.trim() || new URL(record.url).pathname || 'Home').slice(0,300);
   const meta = selector => (doc.querySelector(selector)?.getAttribute('content') || '').trim();
   const url = new URL(record.url), slug = decodeURIComponent(url.pathname).toLowerCase().replace(/^\/+|\/+$/g,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,150) || 'home';
   output.push({key,title,slug,url:record.url,parent_key:'',html:doc.documentElement.outerHTML,css:styles.join('\n'),js:scripts.join('\n;\n'),seo:{title,description:meta('meta[name="description"]').slice(0,1000),canonical:absolute(doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || record.url,base),indexing:/noindex/i.test(meta('meta[name="robots"]'))?'noindex':'default',social_title:meta('meta[property="og:title"]').slice(0,300),social_description:meta('meta[property="og:description"]').slice(0,1000),social_image:absolute(meta('meta[property="og:image"]'),base)}});
  }
  for (const item of output) {
   const path = new URL(item.url).pathname.replace(/\/$/,'').split('/').slice(0,-1).join('/') + '/';
   const parent = path !== '/' && output.find(p => p.url === new URL(path, item.url).href);
   if (parent && parent.key !== item.key) item.parent_key = parent.key;
  }
  const first = output[0], {doc,base} = documents.get(first.url), seen = new Set();
  for (const link of doc.querySelectorAll('nav a[href]')) {
   const url = absolute(link.getAttribute('href'),base), target = output.find(p => p.url === (resources.get(url)?.url || url));
   if (target && link.textContent.trim() && !seen.has(target.key)) { navigation.push({key:target.key,label:link.textContent.trim().slice(0,150)}); seen.add(target.key); }
  }
  if (output.some(p => p.js.trim())) notes.add('Captured scripts will run on imported pages when Keep website interactions is enabled. Use a source you trust.');
  notes.add('Review the imported layout and behavior. Forms, logins, stores, and JavaScript apps may need rebuilding in WordPress.');
  return M.validate({format:'little-studio-website',version:1,site_id:'capture-' + (await hash(encoder.encode(source))).slice(0,24),title:first.title,site_css:'',pages:output,assets,fonts:[],site:{home_key:first.key,navigation:navigation.slice(0,100)},capture:{source,engine:'Little Studio public website capture',warnings:[...notes]}});
 }
 const serializable = project => JSON.stringify(project, (key,value) => key === 'bytes' && value instanceof Uint8Array ? undefined : value, 2);
 let busy = false, cancelled = false, session = null, sequence = 0, records = [], pending = false;
 const dialog = $('#lse-capture-dialog'), form = $('#lse-capture-form'), status = $('#lse-capture-status'), start = $('#lse-capture-start'), retry = $('#lse-capture-retry');
 const buttons = () => { start.disabled = busy; form.querySelectorAll('input,select').forEach(el => el.disabled = busy); $('#lse-capture-close').textContent = busy ? 'Cancel capture' : 'Close'; };
 const cleanup = async () => { const old = session; session = null; if (old) try { await A.request('capture_cancel',{capture:old}); } catch {} };
 async function run(resume = false) {
  if (busy || A.busy || window.LSEManage?.busy) return;
  busy = true; cancelled = false; retry.hidden = true; buttons();
  try {
   if (!resume) { records = []; sequence = 0; status.textContent = 'Starting website capture…'; const job = await A.request('capture_start',{url:$('#lse-capture-url').value,pages:Number($('#lse-capture-pages').value),depth:Number($('#lse-capture-depth').value)}); session = job.capture; }
   while (!cancelled) {
    pending = true;
    const step = await A.request('capture_step',{capture:session,seq:sequence}); pending = false;
    if (cancelled) break;
    if (step.done) {
     status.textContent = 'Packaging your website JSON…';
     const notes = Object.values(step.warnings || {}); if (step.truncated) notes.push('The capture reached a page, depth, or resource limit. Some linked content was not included.');
     const project = await packageWebsite($('#lse-capture-url').value, records, notes);
     if (cancelled) break;
     await cleanup(); busy = false; buttons(); dialog.close();
     // Explicitly open a new import so capture cannot silently replace a selected website.
     $('#lse-new-import').click();
     await A.choose(new File([serializable(project)],new URL($('#lse-capture-url').value).hostname + '.website.json',{type:'application/json'}));
     return;
    }
    if (step.record) records.push(step.record);
    sequence = step.seq; status.textContent = step.message;
   }
   await cleanup(); status.textContent = 'Capture cancelled. No WordPress pages were created.';
  } catch (error) {
   pending = false;
   if (cancelled) { await cleanup(); status.textContent = 'Capture cancelled.'; }
   else { status.textContent = error.message; retry.hidden = !session; }
  } finally { pending = false; busy = false; buttons(); }
 }
 function close() { if (busy) { cancelled = true; status.textContent = pending ? 'Cancelling after the current request…' : 'Cancelling…'; } else { cleanup(); dialog.close(); } }
 function open() { if (A.busy || window.LSEManage?.busy) return; dialog.showModal(); $('#lse-capture-url').focus(); }
 form.addEventListener('submit', e => { e.preventDefault(); run(); }); retry.addEventListener('click', () => run(true));
 $('#lse-capture-close').addEventListener('click', close); dialog.addEventListener('cancel',e => { e.preventDefault(); close(); });
 document.querySelectorAll('[data-capture-open]').forEach(el => el.addEventListener('click',open));
 $('#lse-source-download').addEventListener('click', () => {
  if (!A.project) return;
  const url = URL.createObjectURL(new Blob([serializable(A.project)],{type:'application/json'})), link = document.createElement('a');
  link.href = url; link.download = 'website.website.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
 });
 window.LSECapture = {packageWebsite, get busy(){return busy;}};
})();
