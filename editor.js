import {
  AUTH_PATH, GitHub, slugify, newNote, validateNote, cleanInline,
  blocksFromEditor, editorBlockHTML, tableHTML, createCredential, unlockCredential, safeURL,
  safeImageURL, seal, recoveryPut, recoveryAll, recoveryDelete, localISODate,
} from './editor-core.js';

const $ = id => document.getElementById(id);
const views = ['setupView','unlockView','dashboardView','workspace'];
const body = $('editorBody');
let credential = null, credentialSha = null, key = null, token = null;
let github = new GitHub(), note = null, revision = 0, localRevision = -1;
let saveTimer = null, continuousTimer = null, overdueTimer = null, localWrite = null;
let selectedRange = null, selectedEditable = body, dialogContext = null, busy = false;

function resizeHeadingField(field) {
  field.style.height='auto';
  field.style.height=`${Math.max(field.scrollHeight,1)}px`;
}
function formatDraftTime(value) {
  const time=typeof value==='number'?value:Date.parse(value||'');
  return time ? new Date(time).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Unavailable';
}

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
  const button=$('menuButton');
  button.classList.remove('local-ok','local-pending','local-failed');
  button.classList.add(`local-${state}`);
  const meaning={ok:'Local copy saved',pending:'Saving locally',failed:'Local recovery failed'}[state];
  button.setAttribute('aria-label',`Menu. ${meaning}`);
  button.title=`Menu · ${meaning.toLowerCase()}`;
}
function githubStamp() {
  $('remoteStamp').textContent=note?.remoteSavedAt
    ? `Draft saved to GitHub: ${new Date(note.remoteSavedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}`
    : 'Not yet saved to GitHub';
  updateCollapsedHeader();
}
function updateCollapsedHeader() {
  const collapsed=$('collapsedNote');
  if(!note || $('workspace').hidden || !note.remoteSavedAt) {collapsed.hidden=true;return;}
  const title=$('noteTitle'),toolbar=$('workspace').querySelector('.editor-toolbar');
  const scrolledPastTitle=title.getBoundingClientRect().bottom<=toolbar.getBoundingClientRect().bottom+8;
  collapsed.hidden=!scrolledPastTitle;
  if(!scrolledPastTitle) return;
  $('collapsedTitle').textContent=title.value.trim()||'Untitled note';
  $('collapsedSubtitle').textContent=$('noteSubtitle').value.trim();
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
const paragraphStyles=['h2','h3','p'];
function currentBlock() {
  const node=window.getSelection().anchorNode;
  const block=(node?.nodeType===1?node:node?.parentElement)?.closest?.('p,h2,h3');
  return block?.parentElement===body?block:null;
}
function selectStart(block) {
  const range=document.createRange();range.selectNodeContents(block);range.collapse(true);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  body.focus();retainRange();
  $('styleSelector').value=block.tagName.toLowerCase();
}
function restyleBlock(block,style) {
  if(block.tagName.toLowerCase()===style) return block;
  const selection=window.getSelection(),range=selection.rangeCount?selection.getRangeAt(0):null;
  // Snapshot both ends before replacing the element: moving child nodes would
  // otherwise leave a live DOM Range pointing into the discarded heading.
  const position=(node,offset)=>{
    if(!node || (node!==block && !block.contains(node))) return null;
    const path=[];
    while(node!==block) {
      const parent=node.parentNode;path.unshift([...parent.childNodes].indexOf(node));node=parent;
    }
    return {path,offset};
  };
  const start=range&&position(range.startContainer,range.startOffset);
  const end=range&&position(range.endContainer,range.endOffset);
  const replacement=document.createElement(style);replacement.innerHTML=block.innerHTML;
  block.replaceWith(replacement);
  if(start&&end) {
    const resolve=point=>{
      let node=replacement;
      for(const index of point.path) node=node.childNodes[index]||node;
      return [node,Math.min(point.offset,node.nodeType===3?node.length:node.childNodes.length)];
    };
    const next=document.createRange();next.setStart(...resolve(start));next.setEnd(...resolve(end));
    selection.removeAllRanges();selection.addRange(next);
  }
  $('styleSelector').value=style;retainRange();markChanged();
  return replacement;
}
function advanceBlock(event) {
  if(event.isComposing) return;
  const block=currentBlock(),selection=window.getSelection();
  if(!block || !selection.rangeCount) return;
  const range=selection.getRangeAt(0);
  if(!block.contains(range.startContainer) || !block.contains(range.endContainer)) return;
  event.preventDefault();
  range.deleteContents();
  const trailingRange=document.createRange();
  trailingRange.setStart(range.startContainer,range.startOffset);
  trailingRange.setEnd(block,block.childNodes.length);
  const trailing=trailingRange.extractContents();
  const style=paragraphStyles[Math.min(paragraphStyles.indexOf(block.tagName.toLowerCase())+1,2)];
  const next=document.createElement(style);next.append(trailing);
  if(!next.hasChildNodes()) next.append(document.createElement('br'));
  if(!block.hasChildNodes()) block.append(document.createElement('br'));
  block.after(next);
  selectStart(next);
  // Splitting a paragraph after a reference must not strand its marker again.
  for(const marker of block.querySelectorAll('[data-note-id]')) ensureReferenceTail(marker);
  markChanged();
}
function focusHeading() {
  let first=body.firstElementChild;
  if(first?.tagName==='H2') {selectStart(first);return;}
  if(first?.matches('p,h3') && !first.textContent.replace(/\u200b/g,'').trim() && !first.querySelector('[data-note-id]')) {
    first=restyleBlock(first,'h2');
  } else {
    first=document.createElement('h2');first.append(document.createElement('br'));body.prepend(first);markChanged();
  }
  selectStart(first);
}
function ensureReferenceTail(marker) {
  const block=marker.closest('p,h2,h3');
  if(block?.parentElement!==body) return null;
  const after=document.createRange();after.setStartAfter(marker);after.setEnd(block,block.childNodes.length);
  if(after.toString().replace(/\u200b/g,'').trim()) return null;
  let sibling=marker.nextSibling;
  while(sibling?.nodeType===3 && !sibling.textContent) sibling=sibling.nextSibling;
  if(sibling?.nodeType===1 && sibling.hasAttribute('data-note-tail')) return sibling;
  const tail=document.createElement('span');tail.className='editor-note-tail';tail.dataset.noteTail='true';
  tail.contentEditable='true';tail.append(document.createTextNode('\u200b'));
  marker.after(tail);
  return tail;
}
function refreshBody() {
  body.innerHTML=note.blocks.map(block=>editorBlockHTML(block,note)).join('') || '<h2><br></h2>';
  for(const marker of body.querySelectorAll('[data-note-id]')) ensureReferenceTail(marker);
  layoutNotes();
}
function renderNote(noteId) {
  const data=note.notes[noteId]; if(!data) return null;
  const aside=document.createElement('aside'); aside.className='rail-note'; aside.dataset.noteId=noteId;
  const remove=document.createElement('button'); remove.type='button'; remove.textContent='×'; remove.title='Remove note';
  remove.addEventListener('click',()=>{
    const current=body.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`);
    const tail=current?.nextElementSibling;
    if(tail?.hasAttribute('data-note-tail')) {
      const text=tail.textContent.replace(/\u200b/g,'');
      if(text) tail.replaceWith(document.createTextNode(text));
      else tail.remove();
    }
    current?.remove(); delete note.notes[noteId]; aside.remove(); markChanged(); layoutNotes();
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
    if(!aside) {aside=renderNote(id);rail.append(aside);}
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
  if(note.remoteSha&&!note.savedTitle) note.savedTitle=note.title.trim();
  revision=0; localRevision=locallySaved?0:-1;
  $('noteTitle').value=note.title;
  $('noteSubtitle').value=note.subtitle;
  $('noteRail').replaceChildren();
  view('workspace');
  githubStamp(); refreshBody(); localState(locallySaved?'ok':'pending'); warning();
  document.title=`${note.title || 'New note'} — Write`;
  const query=note.slug?`?draft=${encodeURIComponent(note.slug)}`:`?local=${encodeURIComponent(note.id)}`;
  history.replaceState(null,'',`editor.html${query}`);
  requestAnimationFrame(()=>{resizeHeadingField($('noteTitle'));resizeHeadingField($('noteSubtitle'));layoutNotes();});
  if(!locallySaved) saveLocal();
}
async function showDashboard() {
  if(note) await flushLocal();
  view('dashboardView'); note=null;
  history.replaceState(null,'','editor.html');
  const list=$('draftList'); list.textContent='Loading drafts…';
  try {
    const [files,local]=await Promise.all([github.drafts(),recoveryAll(key)]);
    const entries=[];
    for(const file of files) {
      const slug=file.name.slice(0,-5);
      entries.push({kind:'github',slug,title:slug.replace(/-/g,' '),remoteSha:file.sha||null});
    }
    await Promise.all(entries.map(async entry=>{
      try {
        const source=await github.file(`drafts/${entry.slug}.json`,'drafts');
        const draft=validateNote(JSON.parse(source.text));
        draft.remoteSha=source.sha;entry.document=draft;entry.remoteSha=source.sha;
        entry.savedTitle=draft.savedTitle||draft.title;
        entry.title=draft.title||entry.title;
        entry.updatedAt=Date.parse(draft.remoteSavedAt||'')||0;
        entry.createdAt=Number(draft.createdAt)||0;
        if(!entry.createdAt || !entry.updatedAt) {
          const times=await github.fileTimes(`drafts/${entry.slug}.json`,'drafts').catch(()=>({createdAt:0,savedAt:0}));
          entry.createdAt||=times.createdAt;entry.updatedAt||=times.savedAt;
        }
        if(entry.createdAt&&!draft.createdAt) draft.createdAt=entry.createdAt;
      } catch { /* A damaged remote draft still appears under its filename. */ }
    }));
    for(const record of local) {
      const remote=record.document.slug&&entries.find(entry=>entry.slug===record.document.slug);
      if(remote) {
        if(!record.document.savedTitle&&remote.savedTitle) record.document.savedTitle=remote.savedTitle;
        remote.document=record.document;remote.title=record.document.title||remote.title;
        remote.updatedAt=record.savedAt;remote.createdAt=Number(record.document.createdAt)||remote.createdAt||record.savedAt;
        remote.kind='recovered';
      } else entries.push({kind:'local',document:record.document,slug:record.document.slug,title:record.document.title||'Untitled note',createdAt:Number(record.document.createdAt)||Number(record.document.updatedAt)||record.savedAt,updatedAt:record.savedAt});
    }
    list.replaceChildren();
    if(!entries.length) {const p=document.createElement('p');p.textContent='No drafts yet.';list.append(p);}
    entries.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    for(const entry of entries) {
      const row=document.createElement('div'); row.className='draft-row';
      const button=document.createElement('button'); button.type='button'; button.className='draft-title';button.textContent=entry.title;
      button.addEventListener('click',()=>openDraft(entry));
      const meta=document.createElement('div');meta.className='draft-meta';
      const side=document.createElement('span');side.className='draft-kind';side.textContent={local:'Local recovery',recovered:'Local recovery over GitHub draft',github:'GitHub draft'}[entry.kind];
      const filename=document.createElement('span');filename.className='draft-filename';filename.textContent=`Filename ${entry.slug||'not yet assigned'}`;
      const created=document.createElement('span');created.className='draft-created';created.textContent=`Created ${formatDraftTime(entry.createdAt)}`;
      const saved=document.createElement('span');saved.className='draft-saved';saved.textContent=`Last saved ${formatDraftTime(entry.updatedAt)}`;
      meta.append(side,filename,created,saved);
      const actions=document.createElement('div');actions.className='draft-actions';
      const saveAs=document.createElement('button');saveAs.type='button';saveAs.className='save-as';saveAs.textContent='Save as';
      saveAs.addEventListener('click',()=>openDialog('save-as',null,{entry}));
      const remove=document.createElement('button');remove.type='button';remove.className='delete-draft';remove.textContent='Delete';
      remove.addEventListener('click',()=>openDialog('delete-draft',null,{entry}));
      actions.append(saveAs,remove);row.append(button,meta,actions);list.append(row);
    }
  } catch(error) {list.textContent=`Could not load drafts: ${error.message}`;}
}
async function entryDocument(entry) {
  if(entry.document) return validateNote(structuredClone(entry.document));
  const file=await github.file(`drafts/${entry.slug}.json`,'drafts');
  if(!file) throw new Error('That draft no longer exists on GitHub.');
  const loaded=validateNote(JSON.parse(file.text));loaded.remoteSha=file.sha;
  return loaded;
}
async function availableSlug(value) {
  const base=slugify(value);
  if(!base) throw new Error('Enter a filename containing at least one letter or number.');
  const [local,files]=await Promise.all([recoveryAll(key),github.drafts()]);
  const occupied=new Set([
    ...local.map(record=>record.document.slug).filter(Boolean),
    ...files.map(file=>file.name.slice(0,-5)),
  ]);
  for(let number=1;number<10_000;number++) {
    const candidate=number===1?base:`${base}-${number}`;
    if(occupied.has(candidate)) continue;
    if(!await github.file(`${candidate}.html`,'main')) return candidate;
  }
  throw new Error('Could not find an available filename.');
}
function independentCopy(source,slug) {
  const copy=structuredClone(source),now=Date.now();
  copy.id=crypto.randomUUID();copy.slug=slug;copy.remoteSha=null;copy.remoteSavedAt='';
  copy.savedTitle='';copy.publicationDate='';copy.createdAt=now;copy.updatedAt=now;
  return copy;
}
async function ensureCreatedAt(document) {
  if(Number(document.createdAt)) return;
  if(document.slug&&document.remoteSha) {
    const times=await github.fileTimes(`drafts/${document.slug}.json`,'drafts').catch(()=>({createdAt:0}));
    document.createdAt=times.createdAt||Date.now();return;
  }
  document.createdAt=Date.now();
}
async function openDraft(entry) {
  try {
    const loaded=await entryDocument(entry);
    loadNote(loaded,entry.kind!=='github');
  } catch(error) {notice(`Could not open draft: ${error.message}`,true);}
}
async function resumeRequested() {
  const params=new URLSearchParams(location.search);
  const records=await recoveryAll(key);
  const localId=params.get('local'), slug=params.get('draft');
  const saved=records.find(record=>record.document.id===localId || (slug&&record.document.slug===slug));
  if(saved) {
    if(saved.document.slug&&saved.document.remoteSha&&!saved.document.savedTitle) {
      const remote=await github.file(`drafts/${saved.document.slug}.json`,'drafts').catch(()=>null);
      if(remote) {
        try {saved.document.savedTitle=validateNote(JSON.parse(remote.text)).title.trim();}
        catch { /* Retain the local draft even if the remote file is damaged. */ }
      }
    }
    loadNote(saved.document,true);return;
  }
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
  const caption=anchor?.nodeType===1?anchor.closest?.('[data-image-caption]'):anchor?.parentElement?.closest('[data-image-caption]');
  const noteField=anchor?.nodeType===1?anchor.closest?.('.note-text'):anchor?.parentElement?.closest('.note-text');
  if(body.contains(anchor) || noteField || caption) {
    selectedRange=selection.getRangeAt(0).cloneRange();
    selectedEditable=caption||noteField||body;
  }
}
function restoreRange() {
  if(!selectedRange || !selectedEditable.contains(selectedRange.startContainer)) {focusBodyEnd();return;}
  selectedEditable.focus();
  const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(selectedRange);
}
function syncSelectedEditable() {
  const caption=selectedEditable.closest?.('[data-image-caption]');
  if(caption) {
    const id=caption.closest('[data-object-id]')?.dataset.objectId;
    if(id&&note.objects[id]?.type==='image') note.objects[id].captionHTML=cleanInline(caption.innerHTML,{}, {allowNotes:false});
    return;
  }
  const id=selectedEditable.closest?.('[data-note-id]')?.dataset.noteId;
  if(id) note.notes[id].html=cleanInline(selectedEditable.innerHTML,note.notes,{allowNotes:false});
}
function escapeLegacyCaption(value='') {
  const holder=document.createElement('div');holder.textContent=String(value||'');return holder.innerHTML;
}
function insertNote(type) {
  if(selectedEditable!==body) {notice('Place the cursor in the main text to attach a note.',true);return;}
  restoreRange();
  const id=crypto.randomUUID();
  const marker=document.createElement('span');marker.className='editor-reference';
  marker.contentEditable='false';marker.dataset.noteId=id;marker.textContent=type==='margin'?'⊕':'·';
  const selection=window.getSelection(), range=selection.getRangeAt(0);
  range.collapse(false);range.insertNode(marker);range.setStartAfter(marker);range.collapse(true);
  const tail=ensureReferenceTail(marker);
  if(tail) range.setStart(tail.firstChild,tail.firstChild.length);
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
    const editable=event.target.closest?.('[contenteditable="true"]')||event.currentTarget;
    editable.dispatchEvent(new window.Event('input',{bubbles:true}));
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
function radioGroup(name,label,options,value) {
  const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=label;
  fieldset.className='choice-group';fieldset.append(legend);
  for(const [optionValue,optionLabel] of options) {
    const option=document.createElement('label'),input=document.createElement('input');
    input.type='radio';input.name=name;input.value=optionValue;input.checked=optionValue===value;
    option.append(input,optionLabel);fieldset.append(option);
  }
  return fieldset;
}
function openDialog(type,id=null,context={}) {
  retainRange();
  const object=type==='note'?note.notes[id]:id?note.objects[id]:null;
  dialogContext={type,id,...context};
  const fields=$('dialogFields');fields.replaceChildren();
  const heading={address:'Note address',link:'Link',image:'Image',quote:'Pull quote',table:'Table',note:'Edit note',token:'Replace GitHub token','save-as':'Save draft as','delete-draft':'Delete draft'}[type];
  $('dialogTitle').textContent=heading;
  $('deleteObject').hidden=!id||type==='note';
  const submit=$('contentForm').querySelector('[type=submit]');submit.disabled=false;submit.textContent=id?'Save':'Insert';submit.classList.toggle('danger-button',type==='delete-draft');
  if(type==='address') {
    fields.append(fieldHTML('slug','Filename / future public address (without .html)',slugify(note.title)));
    $('contentForm').querySelector('[type=submit]').textContent='Save draft';
  } else if(type==='link') {
    const start=selectedRange?.startContainer;
    const element=start?.nodeType===1?start:start?.parentElement;
    const existing=element?.closest?.('a');
    dialogContext.linkElement=existing&&selectedEditable.contains(existing)?existing:null;
    fields.append(
      fieldHTML('text','Link text',dialogContext.linkElement?.textContent||selectedRange?.cloneContents().textContent||''),
      fieldHTML('url','Address',dialogContext.linkElement?.getAttribute('href')||'','url'),
    );
    if(dialogContext.linkElement) $('contentForm').querySelector('[type=submit]').textContent='Save';
  } else if(type==='image') {
    if(!id) fields.append(
      fieldHTML('file','Upload image','','file'),
      fieldHTML('externalUrl','Or external HTTPS image address','','url'),
    );
    fields.append(
      fieldHTML('alt','Description (alternative text)',object?.alt||''),
      checkbox('fullwidth','Full width',object?.fullwidth),
      radioGroup('captionPlacement','Caption placement',[['below','Below image'],['side','To the side']],object?.captionPlacement==='side'?'side':'below'),
    );
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
  } else if(type==='save-as') {
    const source=context.entry?.slug||slugify(context.entry?.title||'draft');
    fields.append(fieldHTML('slug','Filename / future public address (without .html)',`${source}-copy`));
    $('contentForm').querySelector('[type=submit]').textContent='Create copy';
  } else if(type==='delete-draft') {
    const warning=document.createElement('p');warning.textContent=`Permanently delete “${context.entry?.title||'Untitled note'}”? This cannot be undone. Any published page is unaffected.`;
    fields.append(warning);$('contentForm').querySelector('[type=submit]').textContent='Delete permanently';
  }
  $('contentDialog').showModal();
  fields.querySelector('input,textarea')?.focus();
}
async function applyDialog(event) {
  event.preventDefault();
  const {type,id}=dialogContext||{};
  const form=$('contentForm');const data=new FormData(form);
  try {
    if(type==='delete-draft') {
      const submit=form.querySelector('[type=submit]');submit.disabled=true;
      const entry=dialogContext.entry;
      if(entry.slug&&entry.remoteSha) await github.deleteDraft(entry.slug,entry.remoteSha);
      const records=await recoveryAll(key);
      for(const record of records) if(record.document.id===entry.document?.id || (entry.slug&&record.document.slug===entry.slug)) await recoveryDelete(record.id);
      $('contentDialog').close();notice('Draft permanently deleted.');await showDashboard();return;
    }
    if(type==='save-as') {
      const submit=form.querySelector('[type=submit]');submit.disabled=true;
      const source=await entryDocument(dialogContext.entry);
      const requested=String(data.get('slug')).trim(),slug=await availableSlug(requested);
      const copy=independentCopy(source,slug);
      await github.saveDraft(copy);
      await recoveryPut(copy.id,copy,key);
      $('contentDialog').close();loadNote(copy,true);notice(`Saved copy as ${slug}. The original draft is unchanged.`);
      return;
    }
    if(type==='address') {
      const slug=await availableSlug(String(data.get('slug')));
      note.slug=slug;markChanged();
      $('contentDialog').close();
      if(dialogContext.intent==='publish') await publish();
      else await writeDraft();
      return;
    }
    if(type==='link') {
      const url=safeURL(data.get('url'));
      if(!url) throw new Error('Use an http(s), mailto, or relative note address.');
      const existing=dialogContext.linkElement;
      if(existing?.isConnected) {
        existing.setAttribute('href',url);existing.textContent=String(data.get('text'))||url;
        if(selectedEditable!==body) syncSelectedEditable();
        markChanged();
        $('contentDialog').close();
        return;
      }
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
      if(selectedEditable!==body) syncSelectedEditable();
      markChanged();
    }
    if(type==='note') {
      note.notes[id].html=String(data.get('text')).replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
      $('noteRail').querySelector(`[data-note-id="${CSS.escape(id)}"] .note-text`).innerHTML=note.notes[id].html;
      markChanged();layoutNotes();
    }
    if(type==='image') {
      let imageData=id?note.objects[id].data:'',external=id?Boolean(note.objects[id].external):false;
      if(!id) {
        const file=data.get('file'),externalUrl=String(data.get('externalUrl')).trim();
        if(file instanceof File&&file.size&&externalUrl) throw new Error('Choose either an uploaded file or an external image address, not both.');
        if(externalUrl) {
          imageData=safeImageURL(externalUrl);
          if(!imageData) throw new Error('External images must use a valid HTTPS address.');
          external=true;
        } else {
          if(!(file instanceof File)||!file.size) throw new Error('Choose an uploaded image or enter an external HTTPS address.');
          if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use PNG, JPEG, GIF, or WebP.');
          if(file.size>10_000_000) throw new Error('Images over 10 MB are not supported.');
          imageData=await new Promise((resolve,reject)=>{
            const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
          });
        }
      }
      const prior=id?note.objects[id]:null;
      const object={type:'image',data:imageData,external,alt:String(data.get('alt')).trim(),captionHTML:prior?.captionHTML??escapeLegacyCaption(prior?.caption),fullwidth:data.has('fullwidth'),captionPlacement:data.get('captionPlacement')==='side'?'side':'below'};
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
  } catch(error) {form.querySelector('[type=submit]').disabled=false;notice(error.message,true);}
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
  $('menuSaveDraft').disabled=$('menuPublish').disabled=true;
  const initialSha=note?.remoteSha;
  const controls=$('workspace').querySelector('.floating-tools');
  controls.style.pointerEvents='none';body.contentEditable='false';
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
    controls.style.pointerEvents='';body.contentEditable='true';
    $('noteTitle').disabled=$('noteSubtitle').disabled=false;
    $('noteRail').style.pointerEvents='';
    busy=false;$('menuSaveDraft').disabled=$('menuPublish').disabled=false;
  }
}
async function writeDraft() {
  await remoteAction(async()=>{
    localSnapshot();
    if(await forkChangedTitle()) return;
    await ensureCreatedAt(note);
    await github.saveDraft(note);
    githubStamp();history.replaceState(null,'',`editor.html?draft=${encodeURIComponent(note.slug)}`);
    revision++;await saveLocal();
    notice('Draft saved to GitHub.');
  });
}
async function forkChangedTitle({publishing=false}={}) {
  const saved=String(note.savedTitle||'').trim(),current=note.title.trim();
  if(!note.remoteSha||!saved||saved===current) return false;
  const sourceId=note.id,slug=await availableSlug(current);
  const copy=independentCopy(note,slug);
  if(publishing) copy.publicationDate=localISODate();
  await github.saveDraft(copy);
  await recoveryPut(copy.id,copy,key);
  await recoveryDelete(sourceId);
  loadNote(copy,true);
  notice(`Title changed. Saved a new draft as ${slug}; the previous draft is unchanged.`);
  return true;
}
async function chooseAddress(intent='save') {
  localSnapshot();
  if(!note.title.trim()) {notice('Add a title before saving to GitHub.',true);$('noteTitle').focus();return false;}
  if(note.slug) return true;
  const suggested=slugify(note.title);
  if(!suggested) {
    openDialog('address');dialogContext.intent=intent;
    notice('Choose a filename for this title.',true);
    return false;
  }
  try {
    note.slug=await availableSlug(suggested);markChanged();
    return true;
  } catch(error) {notice(`Could not check the address: ${error.message}`,true);return false;}
}
async function saveDraft() {if(await chooseAddress()) await writeDraft();}
async function publish() {
  if(!await chooseAddress('publish')) return;
  await remoteAction(async()=>{
    localSnapshot();
    const forked=await forkChangedTitle({publishing:true});
    await ensureCreatedAt(note);
    if(!note.publicationDate) note.publicationDate=localISODate();
    if(!forked) await github.saveDraft(note);
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
$('dashboardLock').addEventListener('click',lock);
$('noteTitle').addEventListener('input',event=>{resizeHeadingField(event.currentTarget);markChanged();updateCollapsedHeader();});
$('noteSubtitle').addEventListener('input',event=>{resizeHeadingField(event.currentTarget);markChanged();updateCollapsedHeader();});
$('noteTitle').addEventListener('keydown',event=>{
  if(event.key==='Enter' && !event.isComposing) {event.preventDefault();$('noteSubtitle').focus();}
});
$('noteSubtitle').addEventListener('keydown',event=>{
  if(event.key==='Enter' && !event.isComposing) {event.preventDefault();focusHeading();}
});
body.addEventListener('input',event=>{
  const caption=event.target.closest?.('[data-image-caption]');
  if(caption) {
    const id=caption.closest('[data-object-id]')?.dataset.objectId;
    if(id&&note.objects[id]?.type==='image') note.objects[id].captionHTML=cleanInline(caption.innerHTML,{}, {allowNotes:false});
  }
  markChanged();layoutNotes();
});
body.addEventListener('paste',plainTextPaste);
body.addEventListener('keydown',event=>{
  if(event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if(event.key==='Tab') {
    const block=currentBlock();if(!block) return;
    event.preventDefault();
    const index=paragraphStyles.indexOf(block.tagName.toLowerCase());
    restyleBlock(block,paragraphStyles[Math.max(0,Math.min(2,index+(event.shiftKey?-1:1)))]);
  } else if(event.key==='Enter' && !event.shiftKey) advanceBlock(event);
});
// Mobile keyboards often dispatch beforeinput without a useful keydown.
body.addEventListener('beforeinput',event=>{
  if(event.inputType==='insertParagraph') advanceBlock(event);
});
body.addEventListener('load',event=>{if(event.target.tagName==='IMG') layoutNotes();},true);
document.fonts?.ready.then(layoutNotes);
body.addEventListener('click',event=>{
  const marker=event.target.closest('[data-note-id]');
  if(marker) {event.preventDefault();openNote(marker.dataset.noteId);return;}
  if(event.target.closest('[data-image-caption]')) return;
  const object=event.target.closest('[data-object-id]');
  if(object) {event.preventDefault();openDialog(note.objects[object.dataset.objectId]?.type,object.dataset.objectId);}
});
document.addEventListener('selectionchange',()=>{
  const selection=window.getSelection(),node=selection.anchorNode;
  if(!node) return;
  retainRange();
  if(!body.contains(node)) return;
  const block=currentBlock();
  if(block) $('styleSelector').value=block.tagName.toLowerCase();
});
$('styleSelector').addEventListener('change',event=>{
  restoreRange();
  const block=currentBlock();
  if(block) restyleBlock(block,event.target.value);
});
function applyInlineFormat(command) {
  restoreRange();
  if(!document.execCommand?.(command,false,null)) {
    notice(`This browser could not apply ${command}.`,true);return;
  }
  if(selectedEditable!==body) {
    syncSelectedEditable();
  }
  selectedEditable.dispatchEvent(new window.Event('input',{bubbles:true}));
  retainRange();
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('commandMenu').hidden) {event.preventDefault();closeCommandMenu();return;}
  const modifier=(event.metaKey||event.ctrlKey)&&!event.altKey;
  if(!modifier || event.isComposing) return;
  const keyName=event.key.toLowerCase();
  if(keyName==='s' && !$('workspace').hidden && !$('contentDialog').open) {
    event.preventDefault();closeCommandMenu();saveDraft();return;
  }
  const surface=event.target.closest?.('.editor-body,.note-text');
  if(!surface) return;
  if(['b','i','u'].includes(keyName)) {
    event.preventDefault();retainRange();
    applyInlineFormat({b:'bold',i:'italic',u:'underline'}[keyName]);
  } else if(keyName==='k') {
    event.preventDefault();retainRange();openDialog('link');
  }
  // Undo and redo retain the browser's native editing history. Their resulting
  // input events flow through the same encrypted local-autosave path.
});
function closeCommandMenu() {
  $('commandMenu').hidden=true;
  $('menuButton').setAttribute('aria-expanded','false');
}

async function toggleFocus() {
  const active=!document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode',active);
  $('exitFocus').hidden=!active;
  if(active) {
    try {await document.documentElement.requestFullscreen();}
    catch {document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;notice('Full screen is unavailable in this browser.',true);}
  }
  else if(document.fullscreenElement) await document.exitFullscreen().catch(()=>{});
}

$('menuButton').addEventListener('pointerdown',retainRange);
$('menuButton').addEventListener('click',()=>{
  const menu=$('commandMenu');
  menu.hidden=!menu.hidden;
  $('menuButton').setAttribute('aria-expanded',String(!menu.hidden));
});
$('commandMenu').addEventListener('click',event=>{
  const insert=event.target.closest('[data-insert]');
  if(insert) {
    closeCommandMenu();
    if(['sidenote','margin'].includes(insert.dataset.insert)) insertNote(insert.dataset.insert==='margin'?'margin':'sidenote');
    else openDialog(insert.dataset.insert);
    return;
  }
  const command=event.target.closest('[data-command]');
  if(!command) return;
  closeCommandMenu();
  if(command.dataset.command==='drafts') showDashboard().catch(error=>notice(error.message,true));
  if(command.dataset.command==='save') saveDraft();
  if(command.dataset.command==='publish') publish();
  if(command.dataset.command==='focus') toggleFocus();
  if(command.dataset.command==='replace-token') openDialog('token');
  if(command.dataset.command==='lock') lock();
});
document.addEventListener('click',event=>{
  if(!event.target.closest('.command-holder')) closeCommandMenu();
});
$('contentForm').addEventListener('submit',applyDialog);
$('cancelDialog').addEventListener('click',()=>$('contentDialog').close());
$('deleteObject').addEventListener('click',()=>{
  const id=dialogContext?.id;
  if(id) {body.querySelector(`[data-object-id="${CSS.escape(id)}"]`)?.remove();delete note.objects[id];markChanged();}
  $('contentDialog').close();
});
$('exitFocus').addEventListener('click',()=>{
  document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
});
document.addEventListener('fullscreenchange',()=>{
  if(!document.fullscreenElement) {document.body.classList.remove('focus-mode');$('exitFocus').hidden=true;}
});
window.addEventListener('scroll',()=>requestAnimationFrame(updateCollapsedHeader),{passive:true});
window.addEventListener('resize',()=>requestAnimationFrame(()=>{
  if(note&&!$('workspace').hidden) {resizeHeadingField($('noteTitle'));resizeHeadingField($('noteSubtitle'));}
  layoutNotes();updateCollapsedHeader();
}));
window.addEventListener('pagehide',()=>{if(revision!==localRevision) saveLocal();token=null;key=null;github=new GitHub();});
window.addEventListener('pageshow',event=>{if(event.persisted) location.reload();});
boot();
