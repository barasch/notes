import {
  AUTH_PATH, GitHub, slugify, newNote, validateNote, cleanInline,
  blocksFromEditor, editorBlockHTML, tableHTML, createCredential, unlockCredential, safeURL,
  seal, recoveryPut, recoveryAll, localISODate,
} from './editor-core.js';

const $ = id => document.getElementById(id);
const views = ['setupView','unlockView','dashboardView','workspace'];
const body = $('editorBody');
let credential = null, credentialSha = null, key = null, token = null;
let github = new GitHub(), note = null, revision = 0, localRevision = -1;
let saveTimer = null, continuousTimer = null, overdueTimer = null, localWrite = null;
let selectedRange = null, selectedEditable = body, dialogContext = null, busy = false;

function view(id) {
  for(const name of views) $(name).hidden = name !== id;
}
function notice(message, error = false) {
  const target=$('toast'); target.textContent=message; target.hidden=false;
  target.style.background=error?'#8f2f23':'';
  clearTimeout(target.timer); target.timer=setTimeout(()=>target.hidden=true,6500);
}
function warning(message='') {
  $('warning').textContent=message; $('warning').hidden=!message;
}
function localState(state) {
  const button=$('insertButton');
  button.classList.remove('local-ok','local-pending','local-failed');
  button.classList.add(`local-${state}`);
  const meaning={ok:'Local copy saved',pending:'Saving locally',failed:'Local recovery failed'}[state];
  button.setAttribute('aria-label',`Insert. ${meaning}`);
  button.title=`Insert · ${meaning.toLowerCase()}`;
}
function githubStamp() {
  $('remoteStamp').textContent=note?.remoteSavedAt
    ? `Draft saved to GitHub: ${new Date(note.remoteSavedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}`
    : 'Not yet saved to GitHub';
}
function localSnapshot() {
  if (!note) return null;
  note.title=$('noteTitle').value;
  note.subtitle=$('noteSubtitle').value;
  note.blocks=blocksFromEditor(body,note.notes);
  const used=new Set([...body.querySelectorAll('[data-note-id]')].map(el=>el.dataset.noteId));
  for (const id of Object.keys(note.notes)) if (!used.has(id)) delete note.notes[id];
  const usedObjects=new Set(note.blocks.filter(block=>block.type==='object').map(block=>block.id));
  for (const id of Object.keys(note.objects)) if (!usedObjects.has(id)) delete note.objects[id];
  note.updatedAt=Date.now();
  return structuredClone(note);
}
function markChanged() {
  if (!note || busy) return;
  revision++;
  localState('pending');
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveLocal,1000);
  if(!continuousTimer) continuousTimer=setInterval(()=>{
    if(revision!==localRevision) saveLocal();
    else { clearInterval(continuousTimer); continuousTimer=null; }
  },5000);
  clearTimeout(overdueTimer);
  overdueTimer=setTimeout(()=>{
    if(revision!==localRevision) {
      localState('failed');
      warning('Local recovery has not saved your latest changes. Try Save draft or check browser storage.');
    }
  },10000);
  requestAnimationFrame(layoutNotes);
}
async function saveLocal() {
  if(!key || !note) return;
  if(localWrite) return localWrite;
  const pendingRevision=revision;
  const snapshot=localSnapshot();
  localWrite=(async()=>{
    try {
      await recoveryPut(snapshot.id,snapshot,key);
      if(revision===pendingRevision) {
        localRevision=revision; localState('ok'); warning(); clearTimeout(overdueTimer);
      } else {
        clearTimeout(saveTimer); saveTimer=setTimeout(saveLocal,500);
      }
    } catch(error) {
      localState('failed');
      warning(`Local recovery could not save: ${error?.message || 'browser storage unavailable'}. Your current text remains in this tab.`);
    } finally { localWrite=null; }
  })();
  return localWrite;
}
async function flushLocal() {
  clearTimeout(saveTimer);
  if(localWrite) await localWrite;
  if(revision!==localRevision) await saveLocal();
  if(revision!==localRevision) throw new Error('Local recovery failed. Your text is still open in this tab.');
}

function focusBodyEnd() {
  const last=body.lastElementChild;
  if(!last || last.matches('[data-object-id]')) body.insertAdjacentHTML('beforeend','<p><br></p>');
  const paragraph=body.lastElementChild;
  const range=document.createRange(); range.selectNodeContents(paragraph); range.collapse(false);
  const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  body.focus();
}
function refreshBody() {
  body.innerHTML=note.blocks.map(block=>editorBlockHTML(block,note)).join('') || '<p><br></p>';
  layoutNotes();
}
function renderNote(noteId,marker) {
  const data=note.notes[noteId]; if(!data) return null;
  const aside=document.createElement('aside'); aside.className='rail-note'; aside.dataset.noteId=noteId;
  const remove=document.createElement('button'); remove.type='button'; remove.textContent='×'; remove.title='Remove note';
  remove.addEventListener('click',()=>{
    marker.remove(); delete note.notes[noteId]; aside.remove(); markChanged(); layoutNotes();
  });
  const field=document.createElement('div'); field.className='note-text'; field.contentEditable='true';
  field.setAttribute('role','textbox'); field.setAttribute('aria-label',data.type==='margin'?'Margin note':'Sidenote');
  field.setAttribute('aria-multiline','true');
  field.innerHTML=cleanInline(data.html,note.notes,{allowNotes:false});
  field.addEventListener('input',()=>{data.html=cleanInline(field.innerHTML,note.notes,{allowNotes:false});markChanged();});
  field.addEventListener('paste',plainTextPaste);
  field.addEventListener('beforeinput',event=>{
    if(event.inputType!=='insertParagraph') return;
    event.preventDefault();
    const selection=window.getSelection();
    if(!selection.rangeCount) return;
    const range=selection.getRangeAt(0);range.deleteContents();
    const breakElement=document.createElement('br');range.insertNode(breakElement);
    range.setStartAfter(breakElement);range.collapse(true);
    selection.removeAllRanges();selection.addRange(range);
    field.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  aside.append(remove,field);
  return aside;
}
function layoutNotes() {
  if(!note || $('workspace').hidden) return;
  const rail=$('noteRail');
  const markers=[...body.querySelectorAll('[data-note-id]')];
  const old=new Map([...rail.children].map(el=>[el.dataset.noteId,el]));
  let sidenoteNumber=0, lowerEdge=0;
  for(const marker of markers) {
    const id=marker.dataset.noteId, data=note.notes[id]; if(!data) continue;
    marker.textContent=data.type==='margin'?'⊕':String(++sidenoteNumber);
    let aside=old.get(id); old.delete(id);
    if(!aside) {aside=renderNote(id,marker);rail.append(aside);}
    const sectionTop=$('editorSection').getBoundingClientRect().top;
    const preferred=marker.getBoundingClientRect().top-sectionTop;
    aside.style.top=`${Math.max(preferred,lowerEdge)}px`;
    lowerEdge=Math.max(preferred,lowerEdge)+aside.getBoundingClientRect().height+14;
  }
  for(const stale of old.values()) stale.remove();
  $('editorSection').style.minHeight=`${Math.max(body.offsetHeight,lowerEdge+24)}px`;
}
function openNote(noteId) {
  const noteField=$('noteRail').querySelector(`[data-note-id="${CSS.escape(noteId)}"] .note-text`);
  if(window.innerWidth>760 && noteField) {noteField.focus();return;}
  openDialog('note',noteId);
}
function loadNote(next,locallySaved=false) {
  note=validateNote(next);
  revision=0; localRevision=locallySaved?0:-1;
  $('noteTitle').value=note.title;
  $('noteSubtitle').value=note.subtitle;
  $('noteRail').replaceChildren();
  view('workspace');
  githubStamp(); refreshBody(); localState(locallySaved?'ok':'pending'); warning();
  document.title=`${note.title || 'New note'} — Write`;
  const query=note.slug?`?draft=${encodeURIComponent(note.slug)}`:`?local=${encodeURIComponent(note.id)}`;
  history.replaceState(null,'',`editor.html${query}`);
  requestAnimationFrame(layoutNotes);
  if(!locallySaved) saveLocal();
}
async function showDashboard() {
  if(note) await flushLocal();
  view('dashboardView'); note=null;
  history.replaceState(null,'','editor.html');
  const list=$('draftList'); list.textContent='Loading drafts…';
  try {
    const [files,local]=await Promise.all([github.drafts(),recoveryAll(key)]);
    const bySlug=new Map(local.filter(r=>r.document.slug).map(r=>[r.document.slug,r]));
    const entries=[];
    for(const file of files) {
      if(bySlug.has(file.name.slice(0,-5))) continue;
      const slug=file.name.slice(0,-5);
      entries.push({kind:'github',slug,title:slug.replace(/-/g,' ')});
    }
    await Promise.all(entries.map(async entry=>{
      try {
        const source=await github.file(`drafts/${entry.slug}.json`,'drafts');
        const draft=validateNote(JSON.parse(source.text));
        entry.title=draft.title||entry.title;
        entry.updatedAt=Date.parse(draft.remoteSavedAt||'')||0;
      } catch { /* A damaged remote draft still appears under its filename. */ }
    }));
    for(const record of local) entries.push({kind:'local',document:record.document,slug:record.document.slug,title:record.document.title||'Untitled note',updatedAt:record.savedAt});
    list.replaceChildren();
    if(!entries.length) {const p=document.createElement('p');p.textContent='No drafts yet.';list.append(p);}
    entries.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    for(const entry of entries) {
      const row=document.createElement('div'); row.className='draft-row';
      const button=document.createElement('button'); button.type='button'; button.textContent=entry.title;
      button.addEventListener('click',()=>openDraft(entry));
      const side=document.createElement('small');side.textContent=entry.kind==='local'?'Local recovery':'GitHub draft';
      row.append(button,side);list.append(row);
    }
  } catch(error) {list.textContent=`Could not load drafts: ${error.message}`;}
}
async function openDraft(entry) {
  try {
    if(entry.kind==='local') {loadNote(entry.document,true);return;}
    const file=await github.file(`drafts/${entry.slug}.json`,'drafts');
    const loaded=validateNote(JSON.parse(file.text));loaded.remoteSha=file.sha;
    loadNote(loaded);
  } catch(error) {notice(`Could not open draft: ${error.message}`,true);}
}
async function resumeRequested() {
  const params=new URLSearchParams(location.search);
  const records=await recoveryAll(key);
  const localId=params.get('local'), slug=params.get('draft');
  const saved=records.find(record=>record.document.id===localId || (slug&&record.document.slug===slug));
  if(saved) {loadNote(saved.document,true);return;}
  if(slug && /^[a-z0-9-]+$/.test(slug)) {
    const file=await github.file(`drafts/${slug}.json`,'drafts');
    if(file) {const loaded=validateNote(JSON.parse(file.text));loaded.remoteSha=file.sha;loadNote(loaded);return;}
  }
  await showDashboard();
}

function retainRange() {
  const selection=window.getSelection();
  if(!selection.rangeCount) return;
  const anchor=selection.anchorNode;
  const noteField=anchor?.nodeType===1?anchor.closest?.('.note-text'):anchor?.parentElement?.closest('.note-text');
  if(body.contains(anchor) || noteField) {
    selectedRange=selection.getRangeAt(0).cloneRange();
    selectedEditable=noteField||body;
  }
}
function restoreRange() {
  if(!selectedRange || !selectedEditable.contains(selectedRange.startContainer)) {focusBodyEnd();return;}
  selectedEditable.focus();
  const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(selectedRange);
}
function insertNote(type) {
  if(selectedEditable!==body) {notice('Place the cursor in the main text to attach a note.',true);return;}
  restoreRange();
  const id=crypto.randomUUID();
  const marker=document.createElement('span');marker.className='editor-reference';
  marker.contentEditable='false';marker.dataset.noteId=id;marker.textContent=type==='margin'?'⊕':'·';
  const selection=window.getSelection(), range=selection.getRangeAt(0);
  range.collapse(false);range.insertNode(marker);range.setStartAfter(marker);range.collapse(true);
  selection.removeAllRanges();selection.addRange(range);
  note.notes[id]={type,html:''};
  markChanged();layoutNotes();openNote(id);
}
function insertObject(object) {
  if(selectedEditable!==body) {notice('Place the cursor in the main text to insert this item.',true);return;}
  restoreRange();
  const id=crypto.randomUUID();note.objects[id]=object;
  const parser=document.createElement('template');parser.innerHTML=editorBlockHTML({type:'object',id},note);
  const element=parser.content.firstElementChild;
  let anchor=window.getSelection().anchorNode;
  if(anchor?.nodeType===3) anchor=anchor.parentElement;
  const paragraph=anchor?.closest?.('p,h2,h3,[data-object-id]');
  if(paragraph && body.contains(paragraph)) paragraph.after(element);
  else body.append(element);
  if(!element.nextElementSibling) element.insertAdjacentHTML('afterend','<p><br></p>');
  markChanged();layoutNotes();
}
function plainTextPaste(event) {
  event.preventDefault();
  const value=event.clipboardData.getData('text/plain');
  if(document.execCommand?.('insertText',false,value)) return;
  const selection=window.getSelection();if(!selection.rangeCount) return;
  const range=selection.getRangeAt(0);range.deleteContents();
  const fragment=document.createDocumentFragment(),lines=value.replace(/\r\n?/g,'\n').split('\n');
  let end=null;
  lines.forEach((line,index)=>{
    if(index) {end=document.createElement('br');fragment.append(end);}
    if(line) {end=document.createTextNode(line);fragment.append(end);}
  });
  if(end) {
    range.insertNode(fragment);range.setStartAfter(end);range.collapse(true);
    selection.removeAllRanges();selection.addRange(range);
    event.currentTarget.dispatchEvent(new window.Event('input',{bubbles:true}));
  }
}

function fieldHTML(name,label,value='',kind='text') {
  const element=document.createElement('label');element.textContent=label;
  const field=document.createElement(kind==='textarea'?'textarea':'input');
  field.name=name;field.value=value;if(kind==='password')field.type='password';
  if(kind==='file') {field.type='file';field.accept='image/png,image/jpeg,image/gif,image/webp';}
  if(kind==='url') field.inputMode='url';
  element.append(field);return element;
}
function checkbox(name,label,value=false) {
  const element=document.createElement('label');element.className='checkbox';
  const input=document.createElement('input');input.type='checkbox';input.name=name;input.checked=value;
  element.append(input,label);return element;
}
function openDialog(type,id=null) {
  retainRange();
  const object=type==='note'?note.notes[id]:id?note.objects[id]:null;
  dialogContext={type,id};
  const fields=$('dialogFields');fields.replaceChildren();
  const heading={address:'Note address',link:'Link',image:'Image',quote:'Pull quote',table:'Table',note:'Edit note',token:'Replace GitHub token'}[type];
  $('dialogTitle').textContent=heading;
  $('deleteObject').hidden=!id||type==='note';
  $('contentForm').querySelector('[type=submit]').textContent=id?'Save':'Insert';
  if(type==='address') {
    fields.append(fieldHTML('slug','Public filename (without .html)',slugify(note.title)));
    $('contentForm').querySelector('[type=submit]').textContent='Save draft';
  } else if(type==='link') {
    fields.append(fieldHTML('text','Link text',selectedRange?.cloneContents().textContent||''),fieldHTML('url','Address','','url'));
  } else if(type==='image') {
    if(!id) fields.append(fieldHTML('file','Image file','','file'));
    fields.append(fieldHTML('alt','Description (alternative text)',object?.alt||''),fieldHTML('caption','Caption',object?.caption||''),checkbox('fullwidth','Full width',object?.fullwidth));
  } else if(type==='quote') {
    fields.append(fieldHTML('text','Quotation',object?.text||'','textarea'),fieldHTML('source','Source (optional)',object?.source||''));
  } else if(type==='table') {
    const hint=document.createElement('p');hint.textContent='Paste tab-separated cells. The first row contains column headings.';
    fields.append(hint,fieldHTML('tsv','Cells',object?.tsv||'','textarea'),fieldHTML('caption','Caption',object?.caption||''),checkbox('fullwidth','Full width',object?.fullwidth));
  } else if(type==='note') {
    const div=document.createElement('div');div.innerHTML=object.html;
    fields.append(fieldHTML('text',object.type==='margin'?'Margin note':'Sidenote',div.textContent,'textarea'));
  } else if(type==='token') {
    fields.append(fieldHTML('token','New fine-grained GitHub token','','password'));
    $('contentForm').querySelector('[type=submit]').textContent='Replace token';
  }
  $('contentDialog').showModal();
  fields.querySelector('input,textarea')?.focus();
}
async function applyDialog(event) {
  event.preventDefault();
  const {type,id}=dialogContext||{};
  const form=$('contentForm');const data=new FormData(form);
  try {
    if(type==='address') {
      const slug=slugify(String(data.get('slug')));
      if(!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Enter a valid note address.');
      const [existing,publicPage]=await Promise.all([
        github.file(`drafts/${slug}.json`,'drafts'),github.file(`${slug}.html`,'main'),
      ]);
      if(existing && !note.remoteSha) throw new Error('That note address is already in use.');
      if(publicPage && !publicPage.text.includes(`<meta name="notes-editor-id" content="${note.id}"/>`)) {
        throw new Error('That public address already belongs to another note. Choose a different filename.');
      }
      note.slug=slug;markChanged();
      $('contentDialog').close();
      if(dialogContext.intent==='publish') await publish();
      else await writeDraft();
      return;
    }
    if(type==='link') {
      const url=safeURL(data.get('url'));
      if(!url) throw new Error('Use an http(s), mailto, or relative note address.');
      restoreRange();
      const text=String(data.get('text'))||url;
      const selection=window.getSelection();
      const range=selection.getRangeAt(0);
      const blockOf=node=>node.nodeType===1?node.closest('p,h2,h3,.note-text'):node.parentElement?.closest('p,h2,h3,.note-text');
      if(!range.collapsed && blockOf(range.startContainer)!==blockOf(range.endContainer)) {
        throw new Error('Select link text within a single paragraph.');
      }
      const anchor=document.createElement('a');anchor.href=url;anchor.textContent=text;
      range.deleteContents();range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);
      selection.removeAllRanges();selection.addRange(range);
      if(selectedEditable!==body) {
        const id=selectedEditable.closest('[data-note-id]')?.dataset.noteId;
        if(id) note.notes[id].html=cleanInline(selectedEditable.innerHTML,note.notes,{allowNotes:false});
      }
      markChanged();
    }
    if(type==='note') {
      note.notes[id].html=String(data.get('text')).replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
      $('noteRail').querySelector(`[data-note-id="${CSS.escape(id)}"] .note-text`).innerHTML=note.notes[id].html;
      markChanged();layoutNotes();
    }
    if(type==='image') {
      let imageData=id?note.objects[id].data:'';
      if(!id) {
        const file=data.get('file');
        if(!(file instanceof File)||!file.size) throw new Error('Choose an image.');
        if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use PNG, JPEG, GIF, or WebP.');
        if(file.size>10_000_000) throw new Error('Images over 10 MB are not supported.');
        imageData=await new Promise((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
        });
      }
      const object={type:'image',data:imageData,alt:String(data.get('alt')).trim(),caption:String(data.get('caption')).trim(),fullwidth:data.has('fullwidth')};
      if(id) updateObject(id,object); else insertObject(object);
    }
    if(type==='quote' || type==='table') {
      const object=type==='quote'
        ? {type:'quote',text:String(data.get('text')).trim(),source:String(data.get('source')).trim()}
        : {type:'table',tsv:String(data.get('tsv')).replace(/\r?\n+$/,''),caption:String(data.get('caption')).trim(),fullwidth:data.has('fullwidth')};
      if(!(object.text||object.tsv.trim())) throw new Error('Add some content first.');
      if(type==='table') tableHTML(object);
      if(id) updateObject(id,object); else insertObject(object);
    }
    if(type==='token') {
      const next=String(data.get('token')).trim();
      if(!next) throw new Error('Paste a new GitHub token.');
      const replacement={...credential,...await seal(`notes-editor-v1:${next}`,key)};
      const result=await new GitHub(next).writeFile(AUTH_PATH,JSON.stringify(replacement,null,2)+'\n','main',credentialSha);
      credential=replacement;credentialSha=result.content.sha;token=next;github=new GitHub(next);
      notice('GitHub token replaced. Local recovery remains available with the same passphrase.');
    }
    $('contentDialog').close();
  } catch(error) {notice(error.message,true);}
}
function updateObject(id,object) {
  note.objects[id]=object;
  const old=body.querySelector(`[data-object-id="${CSS.escape(id)}"]`);
  const parser=document.createElement('template');parser.innerHTML=editorBlockHTML({type:'object',id},note);
  old.replaceWith(parser.content.firstElementChild);markChanged();
}

async function remoteAction(task) {
  if(busy) return;
  busy=true;
  $('saveDraft').disabled=$('publish').disabled=true;
  const initialSha=note?.remoteSha;
  const toolbar=$('workspace').querySelector('.editor-toolbar');
  toolbar.style.pointerEvents='none';body.contentEditable='false';
  $('noteTitle').disabled=$('noteSubtitle').disabled=true;
  $('noteRail').style.pointerEvents='none';
  try {
    try {await flushLocal();}
    catch(error) {warning(`${error.message} Attempting the explicit GitHub action now.`);}
    await task();
  }
  catch(error) {
    notice(error.message,true);
    if(error.conflict) warning('The GitHub draft changed elsewhere. Your local writing is intact; compare it with the draft in the repository before choosing which version to keep.');
  }
  finally {
    if(note && note.remoteSha!==initialSha) {
      githubStamp();revision++;await saveLocal();
    }
    toolbar.style.pointerEvents='';body.contentEditable='true';
    $('noteTitle').disabled=$('noteSubtitle').disabled=false;
    $('noteRail').style.pointerEvents='';
    busy=false;$('saveDraft').disabled=$('publish').disabled=false;
  }
}
async function writeDraft() {
  await remoteAction(async()=>{
    localSnapshot();
    await github.saveDraft(note);
    githubStamp();history.replaceState(null,'',`editor.html?draft=${encodeURIComponent(note.slug)}`);
    revision++;await saveLocal();
    notice('Draft saved to GitHub.');
  });
}
async function chooseAddress(intent='save') {
  if(!note.title.trim()) {notice('Add a title before saving to GitHub.',true);$('noteTitle').focus();return false;}
  if(note.slug) return true;
  const suggested=slugify(note.title);
  if(!suggested) {
    openDialog('address');dialogContext.intent=intent;
    notice('Choose a filename for this title.',true);
    return false;
  }
  try {
    const [draft,publicPage]=await Promise.all([
      github.file(`drafts/${suggested}.json`,'drafts'),github.file(`${suggested}.html`,'main'),
    ]);
    if(draft || publicPage) {
      openDialog('address');dialogContext.intent=intent;
      notice('That address is already in use. Choose another filename.',true);
      return false;
    }
    note.slug=suggested;markChanged();
    return true;
  } catch(error) {notice(`Could not check the address: ${error.message}`,true);return false;}
}
async function saveDraft() {if(await chooseAddress()) await writeDraft();}
async function publish() {
  if(!await chooseAddress('publish')) return;
  await remoteAction(async()=>{
    localSnapshot();
    if(!note.publicationDate) note.publicationDate=localISODate();
    await github.saveDraft(note);
    await github.publish(note);
    githubStamp();revision++;await saveLocal();
    notice(`Published: ${location.origin}${location.pathname.replace(/editor\.html$/,'')}${note.slug}.html`);
  });
}
async function lock() {
  try {if(note) await flushLocal();}
  catch(error) {if(!confirm(`${error.message}\nLock anyway and risk losing unsaved work?`)) return;}
  token=null;key=null;github=new GitHub();note=null;
  location.reload();
}
async function boot() {
  try {
    const auth=await github.file(AUTH_PATH);
    if(!auth) {view('setupView');return;}
    credential=JSON.parse(auth.text);credentialSha=auth.sha;
    view('unlockView');$('unlockPassphrase').focus();
  } catch(error) {view('unlockView');$('unlockError').textContent=`Could not load editor settings: ${error.message}`;}
}

$('setupForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const input=$('setupToken'),password=$('setupPassphrase'),confirmation=$('confirmPassphrase');
  $('setupError').textContent='';
  if(password.value!==confirmation.value) {$('setupError').textContent='Passphrases do not match.';return;}
  if(password.value.length<20) {$('setupError').textContent='Use at least 20 characters, preferably randomly generated.';return;}
  const button=event.target.querySelector('[type=submit]');button.disabled=true;
  try {
    const created=await createCredential(input.value,password.value);
    const client=new GitHub(input.value.trim());
    const result=await client.writeFile(AUTH_PATH,JSON.stringify(created.record,null,2)+'\n');
    credential=created.record;credentialSha=result.content.sha;
    key=created.key;token=input.value.trim();github=client;
    input.value=password.value=confirmation.value='';
    await github.ensureDraftBranch();
    await showDashboard();
  } catch(error) {$('setupError').textContent=`Setup failed: ${error.message}`;}
  finally {button.disabled=false;}
});
$('generatePassphrase').addEventListener('click',()=>{
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  const value=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  $('setupPassphrase').type='text';$('setupPassphrase').value=value;
  $('confirmPassphrase').value=value;
  $('setupPassphrase').focus();$('setupPassphrase').select();
});
$('unlockForm').addEventListener('submit',async event=>{
  event.preventDefault();$('unlockError').textContent='';
  const field=$('unlockPassphrase'),button=event.target.querySelector('button');button.disabled=true;
  try {
    const result=await unlockCredential(credential,field.value);
    key=result.key;token=result.token;github=new GitHub(token);field.value='';
    await resumeRequested();
  } catch(error) {$('unlockError').textContent=error.message;key=null;token=null;}
  finally {button.disabled=false;}
});
$('newNote').addEventListener('click',()=>{loadNote(newNote());markChanged();$('noteTitle').focus();});
$('showDrafts').addEventListener('click',()=>showDashboard().catch(error=>notice(error.message,true)));
$('dashboardLock').addEventListener('click',lock);
$('lockButton').addEventListener('click',lock);
$('replaceToken').addEventListener('click',()=>{$('utilityMenu').open=false;openDialog('token');});
$('noteTitle').addEventListener('input',markChanged);
$('noteSubtitle').addEventListener('input',markChanged);
body.addEventListener('input',()=>{markChanged();layoutNotes();});
body.addEventListener('paste',plainTextPaste);
body.addEventListener('load',event=>{if(event.target.tagName==='IMG') layoutNotes();},true);
document.fonts?.ready.then(layoutNotes);
body.addEventListener('click',event=>{
  const marker=event.target.closest('[data-note-id]');
  if(marker) {event.preventDefault();openNote(marker.dataset.noteId);return;}
  const object=event.target.closest('[data-object-id]');
  if(object) {event.preventDefault();openDialog(note.objects[object.dataset.objectId]?.type,object.dataset.objectId);}
});
document.addEventListener('selectionchange',()=>{
  const selection=window.getSelection(),node=selection.anchorNode;
  if(!node) return;
  retainRange();
  if(!body.contains(node)) return;
  const block=node.nodeType===1?node.closest('p,h2,h3'):node.parentElement?.closest('p,h2,h3');
  if(block) $('styleSelector').value=['p','h2','h3'].includes(block.tagName.toLowerCase())?block.tagName.toLowerCase():'p';
});
$('styleSelector').addEventListener('change',event=>{
  restoreRange();document.execCommand('formatBlock',false,event.target.value);
  markChanged();
});
$('insertButton').addEventListener('pointerdown',retainRange);
$('insertButton').addEventListener('click',()=>{
  const menu=$('insertMenu');menu.hidden=!menu.hidden;
  $('insertButton').setAttribute('aria-expanded',String(!menu.hidden));
});
$('insertMenu').addEventListener('click',event=>{
  const button=event.target.closest('[data-insert]');if(!button)return;
  $('insertMenu').hidden=true;$('insertButton').setAttribute('aria-expanded','false');
  if(['sidenote','margin'].includes(button.dataset.insert)) insertNote(button.dataset.insert==='margin'?'margin':'sidenote');
  else openDialog(button.dataset.insert);
});
document.addEventListener('click',event=>{
  if(!event.target.closest('.insert-holder')) {$('insertMenu').hidden=true;$('insertButton').setAttribute('aria-expanded','false');}
});
$('contentForm').addEventListener('submit',applyDialog);
$('cancelDialog').addEventListener('click',()=>$('contentDialog').close());
$('deleteObject').addEventListener('click',()=>{
  const id=dialogContext?.id;
  if(id) {body.querySelector(`[data-object-id="${CSS.escape(id)}"]`)?.remove();delete note.objects[id];markChanged();}
  $('contentDialog').close();
});
$('saveDraft').addEventListener('click',saveDraft);
$('publish').addEventListener('click',publish);
$('focusButton').addEventListener('click',async()=>{
  const active=!document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode',active);
  $('exitFocus').hidden=!active;
  if(active) {
    try {await document.documentElement.requestFullscreen();}
    catch {document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;notice('Full screen is unavailable in this browser.',true);}
  }
  else if(document.fullscreenElement) await document.exitFullscreen().catch(()=>{});
});
$('exitFocus').addEventListener('click',()=>{
  document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
});
document.addEventListener('fullscreenchange',()=>{
  if(!document.fullscreenElement) {document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;}
});
window.addEventListener('resize',()=>requestAnimationFrame(layoutNotes));
window.addEventListener('pagehide',()=>{if(revision!==localRevision) saveLocal();token=null;key=null;github=new GitHub();});
window.addEventListener('pageshow',event=>{if(event.persisted) location.reload();});
boot();
