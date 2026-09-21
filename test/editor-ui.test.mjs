import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {utf8Base64, unlockCredential, createCredential, recoveryAll, editorBlockHTML, renderPublishedPage} from '../editor-core.js';

const source=readFileSync(new URL('../editor.html',import.meta.url),'utf8');
const files=new Map();
let branchExists=false,githubWrites=0;
const result=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname.replace('/repos/barasch/notes','');
  const method=options.method||'GET';
  if(method==='GET' && path==='/contents/drafts') {
    if(!branchExists) return result({message:'Not Found'},404);
    return result([...files.keys()].filter(name=>name.startsWith('drafts/')&&name.endsWith('.json')).map(name=>({name:name.slice('drafts/'.length)})));
  }
  if(method==='GET' && path.startsWith('/contents/')) {
    const file=files.get(path.slice('/contents/'.length));
    return file?result({sha:file.sha,content:utf8Base64(file.text)}):result({message:'Not Found'},404);
  }
  if(method==='PUT' && path.startsWith('/contents/')) {
    const data=JSON.parse(options.body);
    const decoded=new TextDecoder().decode(Uint8Array.from(atob(data.content),c=>c.charCodeAt(0)));
    const sha=`sha-${++githubWrites}`;
    files.set(path.slice('/contents/'.length),{text:decoded,sha});
    return result({content:{sha},commit:{author:{date:'2026-09-13T12:00:00Z'}}},201);
  }
  if(method==='GET' && path==='/git/ref/heads/drafts') return branchExists?result({object:{sha:'draft-head'}}):result({message:'Not Found'},404);
  if(method==='GET' && path==='/git/ref/heads/main') return result({object:{sha:'main-head'}});
  if(method==='POST' && path==='/git/refs') {branchExists=true;return result({ref:'refs/heads/drafts'},201);}
  throw new Error(`Unexpected API request: ${method} ${path}`);
};
globalThis.indexedDB=indexedDB;

function page(url) {
  const dom=new JSDOM(source,{url,pretendToBeVisual:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const name of ['window','document','history','location','DOMParser','File','FileReader','FormData']) globalThis[name]=dom.window[name];
  globalThis.CSS={escape:value=>value};
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  return dom;
}
async function until(predicate,timeout=3500) {
  const start=Date.now();
  while(!predicate()) {
    if(Date.now()-start>timeout) throw new Error('Timed out waiting for editor state');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}

test('setup, encrypted local autosave, and reload require a passphrase without writing to GitHub',async()=>{
  const first=page('https://barasch.github.io/notes/editor.html');
  await import('../editor.js?first');
  await until(()=>!document.getElementById('setupView').hidden);
  document.getElementById('setupToken').value='token-once';
  document.getElementById('setupPassphrase').value='a-long-example-passphrase-for-testing';
  document.getElementById('confirmPassphrase').value='a-long-example-passphrase-for-testing';
  document.getElementById('setupForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!document.getElementById('dashboardView').hidden);
  assert.equal(githubWrites,1,'only setup has written to GitHub');
  assert.doesNotMatch(files.get('editor-auth.json').text,/token-once/);

  document.getElementById('newNote').click();
  document.getElementById('noteTitle').value='A recovered note';
  document.getElementById('noteTitle').dispatchEvent(new window.Event('input',{bubbles:true}));
  document.getElementById('editorBody').innerHTML='<p>A paragraph that survives a reload.</p>';
  document.getElementById('editorBody').dispatchEvent(new window.Event('input',{bubbles:true}));
  const savedAddress=location.href;
  await until(()=>document.getElementById('menuButton').classList.contains('local-ok'));
  assert.equal(githubWrites,1,'autosaving has made no GitHub API write');
  assert.match(document.getElementById('remoteStamp').textContent,/Not yet saved/);
  document.querySelector('[data-command=save]').click();
  await until(()=>document.getElementById('remoteStamp').textContent.startsWith('Draft saved to GitHub:'));
  assert.equal(document.getElementById('contentDialog').open,false,'the title-derived address needs no second confirmation');
  await until(()=>!document.getElementById('menuSaveDraft').disabled);
  assert.equal(githubWrites,2,'Save draft is the only writing action after setup');
  assert.match(files.get('drafts/a-recovered-note.json').text,/survives a reload/);
  const remoteTime=document.getElementById('remoteStamp').textContent;
  document.getElementById('editorBody').innerHTML='<p>A later paragraph, saved only in this browser.</p>';
  document.getElementById('editorBody').dispatchEvent(new window.Event('input',{bubbles:true}));
  await until(()=>document.getElementById('menuButton').classList.contains('local-ok'));
  assert.equal(document.getElementById('remoteStamp').textContent,remoteTime);
  assert.equal(githubWrites,2);
  first.window.dispatchEvent(new first.window.Event('pagehide'));
  first.window.close();

  const second=page(savedAddress);
  await import('../editor.js?second');
  await until(()=>!document.getElementById('unlockView').hidden);
  assert.equal(document.getElementById('workspace').hidden,true);
  document.getElementById('unlockPassphrase').value='a-long-example-passphrase-for-testing';
  document.getElementById('unlockForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!document.getElementById('workspace').hidden);
  assert.equal(document.querySelectorAll('.toolbar-tools > button').length,0,'workspace commands are inside the menu');
  assert.equal(document.querySelectorAll('#commandMenu [data-insert]').length,6);
  assert.deepEqual(
    [...document.querySelectorAll('#commandMenu [data-command]')].map(button=>button.dataset.command),
    ['drafts','save','publish','focus','replace-token','lock'],
  );
  assert.equal(document.getElementById('noteTitle').value,'A recovered note');
  assert.match(document.getElementById('editorBody').textContent,/saved only in this browser/);
  assert.equal(document.getElementById('remoteStamp').textContent,remoteTime);
  assert.equal(githubWrites,2);

  const editorBody=document.getElementById('editorBody');
  const selectEnd=()=>{
    const text=editorBody.querySelector('p').firstChild;
    const range=document.createRange();range.setStart(text,text.textContent.length);range.collapse(true);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
  };
  selectEnd();
  document.getElementById('menuButton').click();
  document.querySelector('[data-insert=sidenote]').click();
  assert.equal(editorBody.querySelectorAll('[data-note-id]').length,1);
  const noteField=document.querySelector('.rail-note .note-text');
  noteField.innerHTML='A source with <em>emphasis</em>.';
  noteField.dispatchEvent(new window.Event('input',{bubbles:true}));

  selectEnd();
  document.getElementById('menuButton').click();
  document.querySelector('[data-insert=link]').click();
  assert.equal(document.querySelector('#dialogFields [name=url]').type,'text');
  document.querySelector('#dialogFields [name=text]').value='another note';
  document.querySelector('#dialogFields [name=url]').value='another-note.html';
  document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(editorBody.querySelector('a')?.getAttribute('href'),'another-note.html');

  selectEnd();
  document.getElementById('menuButton').click();
  document.querySelector('[data-insert=table]').click();
  document.querySelector('#dialogFields [name=tsv]').value='Year\tTotal\n2025\t2,500';
  document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(editorBody.querySelector('.note-table th')?.textContent,'Year');
  await until(()=>document.getElementById('menuButton').classList.contains('local-ok'));
  assert.equal(githubWrites,2,'inserting notes, links, and tables only changes local recovery');
  const {key}=await unlockCredential(JSON.parse(files.get('editor-auth.json').text),'a-long-example-passphrase-for-testing');
  const recovered=await recoveryAll(key);
  const draft=recovered.find(record=>record.document.slug==='a-recovered-note').document;
  assert.equal(Object.keys(draft.notes).length,1);
  assert.equal(Object.values(draft.objects)[0].type,'table');
  assert.match(draft.blocks[0].html,/another-note.html/);
  second.window.close();
});

test('style shortcuts follow title, subtitle, heading, subsection, body; an end reference remains editable',async()=>{
  const passphrase='a-separate-long-passphrase-for-keyboard-tests';
  const {record:encrypted}=await createCredential('token-for-keyboard-tests',passphrase);
  files.set('editor-auth.json',{text:JSON.stringify(encrypted),sha:'keyboard-auth'});
  const dom=page('https://barasch.github.io/notes/editor.html');
  await import('../editor.js?keyboard');
  await until(()=>!document.getElementById('unlockView').hidden);
  document.getElementById('unlockPassphrase').value=passphrase;
  document.getElementById('unlockForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!document.getElementById('dashboardView').hidden);
  document.getElementById('newNote').click();

  const body=document.getElementById('editorBody'),selector=document.getElementById('styleSelector');
  const title=document.getElementById('noteTitle'),subtitle=document.getElementById('noteSubtitle');
  const key=(target,value,options={})=>target.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options}));
  const caret=(node,offset)=>{
    const range=document.createRange();range.setStart(node,offset);range.collapse(true);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
  };
  assert.deepEqual([...selector.options].map(option=>[option.value,option.textContent]),[
    ['h2','Heading'],['h3','Subsection'],['p','Body'],
  ]);
  assert.equal(document.querySelectorAll('#menuButton svg path').length,1,'three lines share one uniform SVG stroke');
  title.value='A new note';key(title,'Enter');assert.equal(document.activeElement,subtitle);
  subtitle.value='A subtitle';key(subtitle,'Enter');
  assert.equal(body.firstElementChild.tagName,'H2');
  assert.equal(selector.value,'h2');
  const heading=body.firstElementChild;heading.textContent='A heading';caret(heading.firstChild,heading.firstChild.length);
  key(body,'Enter');assert.deepEqual([...body.children].map(block=>block.tagName),['H2','H3']);
  assert.equal(selector.value,'h3');
  const subsection=body.lastElementChild;subsection.textContent='A subsection';caret(subsection.firstChild,subsection.firstChild.length);
  key(body,'Enter');assert.equal(body.lastElementChild.tagName,'P');assert.equal(selector.value,'p');
  const paragraph=body.lastElementChild;paragraph.textContent='Body text';caret(paragraph.firstChild,paragraph.firstChild.length);
  key(body,'Enter');assert.equal(body.lastElementChild.tagName,'P','body continues as body');
  key(body,'Tab',{shiftKey:true});assert.equal(body.lastElementChild.tagName,'H3');
  key(body,'Tab',{shiftKey:true});assert.equal(body.lastElementChild.tagName,'H2');
  key(body,'Tab');assert.equal(body.lastElementChild.tagName,'H3');
  selector.value='p';selector.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(body.lastElementChild.tagName,'P');
  assert.equal(window.getSelection().anchorNode,body.lastElementChild,'the caret stays in the restyled empty block');

  heading.innerHTML='<strong>Before after</strong>';
  caret(heading.firstChild.firstChild,6);
  key(body,'Enter');
  assert.equal(heading.textContent,'Before');
  assert.equal(heading.nextElementSibling.tagName,'H3');
  assert.equal(heading.nextElementSibling.textContent,' after','Return preserves text after the caret');

  body.innerHTML='<p>End of paragraph.</p>';
  const last=body.firstElementChild;caret(last.firstChild,last.firstChild.length);
  document.getElementById('menuButton').click();
  document.querySelector('[data-insert=sidenote]').click();
  const marker=last.querySelector('[data-note-id]');
  const tail=last.querySelector('[data-note-tail]');
  assert.ok(marker && tail,'an editable target follows the end-of-paragraph marker');
  assert.equal(tail.previousElementSibling,marker);
  assert.equal(tail.textContent,'\u200b');
  assert.equal(tail.contentEditable,'true');
  body.focus();caret(tail.firstChild,tail.firstChild.length);
  tail.firstChild.appendData(' Continuing here.');
  body.dispatchEvent(new window.Event('input',{bubbles:true}));
  await until(()=>document.getElementById('menuButton').classList.contains('local-ok'));
  const {key:recoveryKey}=await unlockCredential(encrypted,passphrase);
  const records=await recoveryAll(recoveryKey);
  const saved=records.find(record=>record.document.title==='A new note').document;
  assert.match(saved.blocks[0].html,/data-note-tail="true"/);
  assert.match(saved.blocks[0].html,/Continuing here/);
  const rendered=editorBlockHTML(saved.blocks[0],saved);
  assert.match(rendered,/data-note-tail="true"/,'the click target survives local recovery');
  saved.slug='a-new-note';
  const published=renderPublishedPage(saved);
  assert.match(published,/Continuing here/);
  assert.doesNotMatch(published,/data-note-tail|\u200b/,'the editor-only target is absent from the published note');
  caret(tail.firstChild,tail.firstChild.length);
  key(body,'Tab',{shiftKey:true});
  assert.equal(body.firstElementChild.tagName,'H3');
  document.querySelector('.rail-note button').click();
  assert.equal(body.querySelector('[data-note-id]'),null,'a reference remains removable after restyling');
  assert.match(body.textContent,/Continuing here/,'removing a reference does not erase subsequent writing');
  await until(()=>document.getElementById('menuButton').classList.contains('local-ok'));
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});

test('floating controls, compact saved title, common shortcuts, and Save as preserve the original draft',async()=>{
  const passphrase='a-third-long-passphrase-for-interface-tests';
  const {record:encrypted}=await createCredential('token-for-interface-tests',passphrase);
  files.set('editor-auth.json',{text:JSON.stringify(encrypted),sha:'interface-auth'});
  const dom=page('https://barasch.github.io/notes/editor.html');
  const commands=[];document.execCommand=command=>{commands.push(command);return true;};
  await import('../editor.js?interface');
  await until(()=>!document.getElementById('unlockView').hidden);
  document.getElementById('unlockPassphrase').value=passphrase;
  document.getElementById('unlockForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!document.getElementById('dashboardView').hidden);
  document.getElementById('newNote').click();

  const workspace=document.getElementById('workspace');
  const controls=workspace.querySelector('.floating-tools');
  assert.ok(controls);
  assert.equal(workspace.querySelector('.editor-toolbar .floating-tools'),null,'controls are independent of the sticky header');
  const title=document.getElementById('noteTitle'),subtitle=document.getElementById('noteSubtitle');
  title.value='Original title';title.dispatchEvent(new window.Event('input',{bubbles:true}));
  subtitle.value='A compact subtitle';subtitle.dispatchEvent(new window.Event('input',{bubbles:true}));
  const editor=document.getElementById('editorBody');editor.innerHTML='<p>Formatted text</p>';
  const text=editor.querySelector('p').firstChild;
  const range=document.createRange();range.selectNodeContents(text);
  window.getSelection().removeAllRanges();window.getSelection().addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  const shortcut=(key,options={})=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,metaKey:true,...options}));
  shortcut('b');shortcut('i');shortcut('u');
  assert.deepEqual(commands,['bold','italic','underline']);
  shortcut('k');assert.equal(document.getElementById('contentDialog').open,true);
  document.querySelector('#dialogFields [name=text]').value='Linked text';
  document.querySelector('#dialogFields [name=url]').value='first-note.html';
  document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const link=editor.querySelector('a');assert.equal(link.getAttribute('href'),'first-note.html');
  const linkRange=document.createRange();linkRange.selectNodeContents(link.firstChild);
  window.getSelection().removeAllRanges();window.getSelection().addRange(linkRange);
  document.dispatchEvent(new window.Event('selectionchange'));
  shortcut('k');assert.equal(document.querySelector('#dialogFields [name=url]').value,'first-note.html');
  document.querySelector('#dialogFields [name=url]').value='revised-note.html';
  document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(editor.querySelectorAll('a').length,1,'editing a link does not nest another link');
  assert.equal(link.getAttribute('href'),'revised-note.html');
  assert.equal(shortcut('z'),true,'undo is left to the browser editing history');
  assert.equal(shortcut('Z',{shiftKey:true}),true,'redo is left to the browser editing history');

  const titleRect=title.getBoundingClientRect,toolbar=workspace.querySelector('.editor-toolbar');
  title.getBoundingClientRect=()=>({bottom:0});toolbar.getBoundingClientRect=()=>({bottom:61});
  window.dispatchEvent(new window.Event('scroll'));
  await new Promise(resolve=>requestAnimationFrame(resolve));
  assert.equal(document.getElementById('collapsedNote').hidden,true,'a merely local draft does not enter the header');

  assert.equal(document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'s',bubbles:true,cancelable:true,metaKey:true})),false,'Command-S is captured by the editor');
  await until(()=>document.getElementById('remoteStamp').textContent.startsWith('Draft saved to GitHub:'));
  window.dispatchEvent(new window.Event('scroll'));
  await new Promise(resolve=>requestAnimationFrame(resolve));
  assert.equal(document.getElementById('collapsedNote').hidden,false);
  assert.equal(document.getElementById('collapsedTitle').textContent,'Original title');
  assert.equal(document.getElementById('collapsedSubtitle').textContent,'A compact subtitle');
  const original=files.get('drafts/original-title.json').text;
  const originalId=JSON.parse(original).id;

  document.getElementById('menuButton').click();
  document.querySelector('[data-command=drafts]').click();
  await until(()=>!document.getElementById('dashboardView').hidden);
  const originalRow=[...document.querySelectorAll('.draft-row')].find(row=>row.querySelector('.draft-title')?.textContent==='Original title');
  assert.ok(originalRow);originalRow.querySelector('.save-as').click();
  const newTitle=document.querySelector('#dialogFields [name=title]');newTitle.value='Independent copy';
  document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!document.getElementById('workspace').hidden && title.value==='Independent copy');
  assert.equal(files.get('drafts/original-title.json').text,original,'Save as leaves the source draft byte-for-byte intact');
  const copy=JSON.parse(files.get('drafts/independent-copy.json').text);
  assert.notEqual(copy.id,originalId,'the copy has an independent note identity');
  assert.equal(copy.title,'Independent copy');
  assert.equal(copy.publicationDate,'');
  title.getBoundingClientRect=titleRect;
  dom.window.close();
});
