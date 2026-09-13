import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {utf8Base64, unlockCredential, recoveryAll} from '../editor-core.js';

const source=readFileSync(new URL('../editor.html',import.meta.url),'utf8');
const files=new Map();
let branchExists=false,githubWrites=0;
const result=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname.replace('/repos/barasch/notes','');
  const method=options.method||'GET';
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
