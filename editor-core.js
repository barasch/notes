export const REPOSITORY = 'barasch/notes';
export const DRAFT_BRANCH = 'drafts';
export const AUTH_PATH = 'editor-auth.json';
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const ITERATIONS = 500_000;

export function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90).replace(/-$/, '');
}

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function safeURL(value) {
  const url = String(value || '').trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url) || url.startsWith('//')) return '';
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return url.startsWith('/') ? '' : url;
}

export function newNote() {
  return {
    version: 1, id: crypto.randomUUID(), slug: '', title: '', subtitle: '',
    publicationDate: '', remoteSha: null, blocks: [{type:'p',html:''}],
    notes: {}, objects: {}, updatedAt: Date.now(),
  };
}

export function validateNote(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.blocks) || !value.notes || !value.objects) {
    throw new Error('This draft uses a format the editor cannot read. No changes were made.');
  }
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)
    || (value.slug && !/^[a-z0-9-]{1,90}$/.test(value.slug))
    || Object.keys(value.notes).some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id))
    || Object.keys(value.objects).some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id))) {
    throw new Error('This draft has an invalid address or reference. No changes were made.');
  }
  return value;
}

// The same narrow HTML vocabulary is used for live editing, local recovery, and publication.
// In particular, pasted markup can never introduce scripts or new image URLs.
export function cleanInline(html, notes, {published = false, allowNotes = true} = {}) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const isBlock = node => node.nodeType === 1 && /^(DIV|P)$/.test(node.tagName);
  const walkChildren = nodes => nodes.map((node,index) => {
    const previous=nodes[index-1];
    const needsBreak=index>0 && (isBlock(node)||isBlock(previous))
      && node.nodeName!=='BR' && previous.nodeName!=='BR';
    return `${needsBreak ? '<br>' : ''}${walk(node)}`;
  }).join('');
  const walk = node => {
    if (node.nodeType === 3) return escapeHTML(node.nodeValue);
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'span' && allowNotes && node.hasAttribute('data-note-id')) {
      const id = node.getAttribute('data-note-id');
      const note = notes[id];
      if (!note || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return '';
      if (!published) return `<span class="editor-reference" data-note-id="${id}" contenteditable="false">${note.type === 'margin' ? '⊕' : '·'}</span>`;
      const prefix = note.type === 'margin' ? 'mn' : 'sn';
      const noteId = `${prefix}-${id}`;
      const label = note.type === 'margin'
        ? `<label for="${noteId}" class="margin-toggle">&#8853;</label>`
        : `<label for="${noteId}" class="margin-toggle sidenote-number"></label>`;
      return `${label}<input type="checkbox" id="${noteId}" class="margin-toggle"/><span class="${note.type === 'margin' ? 'marginnote' : 'sidenote'}">${cleanInline(note.html, notes, {allowNotes:false})}</span>`;
    }
    const inner = walkChildren([...node.childNodes]);
    if (tag === 'br') return '<br>';
    if (tag === 'b' || tag === 'strong') return `<strong>${inner}</strong>`;
    if (tag === 'i' || tag === 'em') return `<em>${inner}</em>`;
    if (tag === 'cite' || tag === 'sup' || tag === 'sub') return `<${tag}>${inner}</${tag}>`;
    if (tag === 'a') {
      const href = safeURL(node.getAttribute('href'));
      return href ? `<a href="${escapeHTML(href)}">${inner}</a>` : inner;
    }
    return inner;
  };
  return walkChildren([...template.content.childNodes]);
}

export function blocksFromEditor(editor, notes) {
  const blocks = [];
  const add = node => {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) blocks.push({type:'p',html:escapeHTML(node.textContent)});
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.hasAttribute('data-object-id')) {
      blocks.push({type:'object',id:node.getAttribute('data-object-id')});
      return;
    }
    const tag = node.tagName.toLowerCase();
    if (['p','h2','h3'].includes(tag)) {
      blocks.push({type:tag,html:cleanInline(node.innerHTML,notes)});
    } else if (tag === 'div' && [...node.children].some(child => /^(P|DIV|H2|H3|FIGURE)$/.test(child.tagName))) {
      [...node.childNodes].forEach(add);
    } else {
      blocks.push({type:'p',html:cleanInline(node.innerHTML,notes)});
    }
  };
  [...editor.childNodes].forEach(add);
  return blocks.length ? blocks : [{type:'p',html:''}];
}

export function editorBlockHTML(block, doc) {
  if (block.type === 'object') {
    const object = doc.objects[block.id];
    if (!object) return '';
    const id = escapeHTML(block.id);
    if (object.type === 'image') {
      return `<figure class="editor-object ${object.fullwidth ? 'fullwidth' : ''}" data-object-id="${id}" contenteditable="false"><img src="${escapeHTML(object.data)}" alt="${escapeHTML(object.alt)}"><figcaption>${escapeHTML(object.caption || '')}</figcaption></figure>`;
    }
    if (object.type === 'table') {
      return `<div class="editor-object editor-table ${object.fullwidth ? 'fullwidth' : ''}" data-object-id="${id}" contenteditable="false">${tableHTML(object)}</div>`;
    }
    return `<blockquote class="editor-object pullquote" data-object-id="${id}" contenteditable="false"><p>${escapeHTML(object.text)}</p>${object.source ? `<footer>${escapeHTML(object.source)}</footer>` : ''}</blockquote>`;
  }
  const tag = ['p','h2','h3'].includes(block.type) ? block.type : 'p';
  return `<${tag}>${cleanInline(block.html,doc.notes) || '<br>'}</${tag}>`;
}

export function tableHTML(object) {
  const source = String(object.tsv || '').replace(/\r?\n+$/, '');
  if (!source.trim()) return '';
  const rows = source.split(/\r?\n/).map(row => row.split('\t'));
  if (rows.length > 1001 || rows.some(row => row.length > 20)) {
    throw new Error('Tables support up to 20 columns and 1,000 data rows.');
  }
  const maxColumns = Math.max(...rows.map(row=>row.length));
  const header=`<tr>${Array.from({length:maxColumns},(_,col)=>`<th scope="col">${escapeHTML(rows[0][col] || '')}</th>`).join('')}</tr>`;
  const data=rows.slice(1).map(row=>`<tr>${Array.from({length:maxColumns},(_,col)=>{
    const value=row[col]||'';
    return `<td${/^[\s$€£−+\-\d,.%]+$/.test(value) ? ' class="numeric"' : ''}>${escapeHTML(value)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="note-table">${object.caption ? `<caption>${escapeHTML(object.caption)}</caption>` : ''}<thead>${header}</thead><tbody>${data}</tbody></table>`;
}

export function imagePath(note, id, object) {
  const subtype = object.data.match(/^data:image\/(png|jpeg|gif|webp);base64,/i)?.[1]?.toLowerCase();
  if (!subtype) throw new Error('Unsupported image format. Use PNG, JPEG, GIF, or WebP.');
  return `img/${note.slug}/${id}.${subtype === 'jpeg' ? 'jpg' : subtype}`;
}

export function publishedBlockHTML(block, doc) {
  if (block.type === 'object') {
    const object = doc.objects[block.id];
    if (!object) return '';
    if (object.type === 'image') return `<figure${object.fullwidth ? ' class="fullwidth"' : ''}><img src="${imagePath(doc,block.id,object)}" alt="${escapeHTML(object.alt)}"/>${object.caption ? `<figcaption>${escapeHTML(object.caption)}</figcaption>` : ''}</figure>`;
    if (object.type === 'table') return `<div class="table-wrapper editor-published-table ${object.fullwidth ? 'fullwidth' : ''}">${tableHTML(object)}</div>`;
    return `<blockquote class="pullquote"><p>${escapeHTML(object.text)}</p>${object.source ? `<footer>${escapeHTML(object.source)}</footer>` : ''}</blockquote>`;
  }
  const tag = ['p','h2','h3'].includes(block.type) ? block.type : 'p';
  return `<${tag}>${cleanInline(block.html,doc.notes,{published:true})}</${tag}>`;
}

export function renderPublishedPage(doc) {
  validateNote(doc);
  if (!doc.slug || !doc.title.trim()) throw new Error('Add a title and save a draft before publishing.');
  const sections = ['<section>'];
  for (const block of doc.blocks) {
    if (block.type === 'h2') sections.push('</section>','<section>');
    sections.push(publishedBlockHTML(block,doc));
  }
  sections.push('</section>');
  const title = escapeHTML(doc.title.trim());
  const subtitle = doc.subtitle.trim();
  const date = doc.publicationDate || localISODate();
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8"/>\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="date" content="${escapeHTML(date)}"/>\n  <meta name="notes-editor" content="1"/>\n  <meta name="notes-editor-id" content="${escapeHTML(doc.id)}"/>\n  <meta name="description" content="${escapeHTML(subtitle || doc.title)}"/>\n  <title>${title} — Notes</title>\n  <link rel="stylesheet" href="tufte.css"/>\n  <link rel="icon" type="image/png" href="favicon.png"/>\n</head>\n<body>\n  <header class="site-header" id="top"><a class="site-wordmark" href="index.html" aria-label="Notes home"><img src="favicon.png" alt=""/><span>Notes</span></a><nav class="site-links" aria-label="Related sites"><a href="https://barasch.github.io/observatory/">Observatory</a><a href="https://barasch.github.io/the-city/">The City</a><a href="https://barasch.github.io/othello/">Othello</a></nav></header>\n  <article>\n    <h1 class="page-title">${title}</h1>\n    ${subtitle ? `<p class="subtitle">${escapeHTML(subtitle)}</p>` : ''}\n    <p class="publication-date"><time datetime="${escapeHTML(date)}">${escapeHTML(formatDate(date))}</time></p>\n    ${sections.join('\n    ')}\n  </article>\n  <footer class="site-footer"><nav class="footer-links" aria-label="Footer"><a href="index.html">Notes</a><a href="#top">Top</a></nav></footer>\n</body>\n</html>\n`;
}

export function localISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function formatDate(date) {
  const [y,m,d] = date.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
}

export function updateIndex(html, note) {
  const parser = new DOMParser();
  const page = parser.parseFromString(html,'text/html');
  const list = page.querySelector('.notes-list');
  if (!list) throw new Error('The notes index has no published-notes list.');
  const previous = [...list.children].find(li => li.getAttribute('data-note-slug') === note.slug);
  const item = previous || page.createElement('li');
  item.setAttribute('data-note-slug',note.slug);
  item.replaceChildren();
  const link = page.createElement('a'); link.href = `${note.slug}.html`; link.textContent = note.title.trim();
  const time = page.createElement('time'); time.className = 'publication-date';
  time.dateTime = note.publicationDate; time.textContent = formatDate(note.publicationDate);
  item.append(link,time);
  if (!previous) list.prepend(item);
  return `<!DOCTYPE html>\n${page.documentElement.outerHTML}\n`;
}

const bytesToBase64 = bytes => {
  let binary = '';
  for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
};
const base64ToBytes = text => Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0));
export const utf8Base64 = value => bytesToBase64(new TextEncoder().encode(value));
export const base64UTF8 = value => new TextDecoder().decode(base64ToBytes(value));

export function freshSalt() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(16))); }
export async function keyFromPassphrase(passphrase,salt,iterations=ITERATIONS) {
  const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:base64ToBytes(salt),iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(value,key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  return {iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(cipher))};
}
export async function unseal(record,key) {
  const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(record.iv)},key,base64ToBytes(record.data));
  return new TextDecoder().decode(plaintext);
}
export async function createCredential(token,passphrase) {
  const salt=freshSalt(); const key=await keyFromPassphrase(passphrase,salt);
  return {record:{version:1,salt,iterations:ITERATIONS,...await seal(`notes-editor-v1:${token.trim()}`,key)},key};
}
export async function unlockCredential(record,passphrase) {
  if (record?.version !== 1 || !record.salt || !record.iterations) throw new Error('Unknown credential format.');
  const key=await keyFromPassphrase(passphrase,record.salt,record.iterations);
  let value;
  try { value=await unseal(record,key); } catch { throw new Error('Incorrect passphrase.'); }
  if (!value.startsWith('notes-editor-v1:')) throw new Error('Incorrect credential format.');
  return {key,token:value.slice('notes-editor-v1:'.length)};
}

export class GitHub {
  constructor(token='') { this.token=token; }
  async request(path,{method='GET',body,allow404=false}={}) {
    const response=await fetch(`${API_ROOT}${path}`,{
      method,cache:'no-store',headers:{Accept:'application/vnd.github+json',...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    if (allow404 && response.status===404) return null;
    if (!response.ok) {
      const json=await response.json().catch(()=>({}));
      const error=new Error(json.message || `GitHub returned ${response.status}.`);
      error.status=response.status; throw error;
    }
    return response.json();
  }
  async file(path,branch='main') {
    const file=await this.request(`/contents/${path}?ref=${encodeURIComponent(branch)}`,{allow404:true});
    if (!file) return null;
    // The contents endpoint omits inline content for files over 1 MB. Images can
    // make an editable JSON draft that large; the Git blob still holds it.
    const content=file.content || (await this.request(`/git/blobs/${file.sha}`)).content;
    return {sha:file.sha,text:base64UTF8(content)};
  }
  async writeFile(path,text,branch='main',sha) {
    return this.request(`/contents/${path}`,{method:'PUT',body:{message:`Save ${path}`,content:utf8Base64(text),branch,...(sha?{sha}:{})}});
  }
  async ref(branch) { return this.request(`/git/ref/heads/${branch}`,{allow404:true}); }
  async ensureDraftBranch() {
    if (await this.ref(DRAFT_BRANCH)) return;
    const main=await this.ref('main');
    try { await this.request('/git/refs',{method:'POST',body:{ref:`refs/heads/${DRAFT_BRANCH}`,sha:main.object.sha}}); }
    catch(error) { if (!await this.ref(DRAFT_BRANCH)) throw error; }
  }
  async drafts() {
    const files=await this.request(`/contents/drafts?ref=${DRAFT_BRANCH}`,{allow404:true});
    return Array.isArray(files) ? files.filter(file=>file.name.endsWith('.json')) : [];
  }
  async saveDraft(note) {
    await this.ensureDraftBranch();
    const path=`drafts/${note.slug}.json`;
    const existing=await this.file(path,DRAFT_BRANCH);
    if ((existing?.sha || null)!==(note.remoteSha || null)) {
      const error=new Error('The GitHub draft changed elsewhere. Your local copy is intact.');
      error.conflict=true; throw error;
    }
    const savedAt=new Date().toISOString();
    const source={...note,remoteSha:undefined,remoteSavedAt:savedAt};
    const result=await this.writeFile(path,JSON.stringify(source,null,2)+'\n',DRAFT_BRANCH,existing?.sha);
    note.remoteSha=result.content.sha;
    note.remoteSavedAt=savedAt;
    return result;
  }
  async publish(note) {
    const current=await this.file(`${note.slug}.html`,'main');
    if (current && !current.text.includes(`<meta name="notes-editor-id" content="${escapeHTML(note.id)}"/>`)) {
      throw new Error('That public address belongs to another note. Choose another filename.');
    }
    const main=await this.ref('main');
    const parent=await this.request(`/git/commits/${main.object.sha}`);
    const index=await this.file('index.html','main');
    const tree=[
      {path:`${note.slug}.html`,mode:'100644',type:'blob',content:renderPublishedPage(note)},
      {path:'index.html',mode:'100644',type:'blob',content:updateIndex(index.text,note)},
    ];
    for(const [id,object] of Object.entries(note.objects)) {
      if(object.type!=='image') continue;
      const data=object.data.split(',')[1];
      const blob=await this.request('/git/blobs',{method:'POST',body:{content:data,encoding:'base64'}});
      tree.push({path:imagePath(note,id,object),mode:'100644',type:'blob',sha:blob.sha});
    }
    const nextTree=await this.request('/git/trees',{method:'POST',body:{base_tree:parent.tree.sha,tree}});
    const commit=await this.request('/git/commits',{method:'POST',body:{message:`Publish ${note.title.trim()}`,tree:nextTree.sha,parents:[main.object.sha]}});
    await this.request('/git/refs/heads/main',{method:'PATCH',body:{sha:commit.sha,force:false}});
    return commit;
  }
}

export function openRecoveryDB() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('notes-editor-recovery',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function recoveryPut(id,document,key) {
  const db=await openRecoveryDB();
  const envelope=await seal(JSON.stringify(document),key);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');
    tx.objectStore('drafts').put({id,...envelope,savedAt:Date.now()});
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
    tx.onabort=()=>{db.close();reject(tx.error);};
  });
}
export async function recoveryAll(key) {
  const db=await openRecoveryDB();
  const records=await new Promise((resolve,reject)=>{
    const request=db.transaction('drafts').objectStore('drafts').getAll();
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  db.close();
  const drafts=[];
  for(const record of records) {
    try { drafts.push({...record,document:validateNote(JSON.parse(await unseal(record,key)))}); }
    catch { /* A replaced credential may leave old local copies unreadable. */ }
  }
  return drafts;
}
