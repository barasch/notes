import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {
  GitHub, slugify, newNote, renderPublishedPage, updateIndex, createCredential,
  unlockCredential, recoveryPut, recoveryAll, utf8Base64, cleanInline,
} from '../editor-core.js';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://barasch.github.io/notes/editor.html'});
globalThis.document=dom.window.document;
globalThis.DOMParser=dom.window.DOMParser;
globalThis.indexedDB=indexedDB;

test('slug and generated article preserve note anchors and reject pasted scripts',()=>{
  assert.equal(slugify('Memory & Identity: Notes'), 'memory-identity-notes');
  const note=newNote(); note.slug='memory-identity';note.title='Memory & Identity';
  note.subtitle='An example';note.publicationDate='2026-09-13';
  note.notes['a1']={type:'sidenote',html:'Source: <a href="https://example.org/paper">paper</a>'};
  note.notes['b2']={type:'margin',html:'Context'};
  note.blocks=[{type:'p',html:'Claim<span class="editor-reference" data-note-id="a1"></span> and another<span data-note-id="b2"></span>. <script>alert(1)</script><a href="javascript:alert(1)">bad link</a>'}];
  const page=renderPublishedPage(note);
  assert.match(page,/label for="sn-a1" class="margin-toggle sidenote-number"/);
  assert.match(page,/input type="checkbox" id="sn-a1" class="margin-toggle"/);
  assert.match(page,/span class="sidenote">Source: <a href="https:\/\/example.org\/paper">paper<\/a>/);
  assert.match(page,/label for="mn-b2" class="margin-toggle"/);
  assert.doesNotMatch(page,/<script|href="javascript:/);
  assert.match(page,/&amp; Identity/);
  assert.equal(cleanInline('<img src=x onerror=alert(1)>Safe',{}),'Safe');
  assert.equal(cleanInline('First<div>Second</div><div>Third</div>',{}),'First<br>Second<br>Third');
  assert.equal(cleanInline('<u>Underlined</u>',{}),'<u>Underlined</u>');
});

test('tables, images, and index entries publish as semantic HTML without duplicate links',()=>{
  const note=newNote();note.slug='numbers';note.title='Numbers';note.publicationDate='2026-09-13';
  note.objects.t1={type:'table',caption:'Annual figures',tsv:'Year\tTotal\n2024\t1,200\n2025\t2,500',fullwidth:true};
  note.objects.i1={type:'image',data:'data:image/png;base64,aGVsbG8=',alt:'A chart',captionHTML:'Figure <em>one</em> with <a href="https://example.org/source">source</a>.',captionPlacement:'side',fullwidth:false};
  note.objects.i2={type:'image',data:'https://images.example.org/chart.jpg',external:true,alt:'External chart',captionHTML:'External figure',captionPlacement:'below',fullwidth:true};
  note.blocks=[{type:'object',id:'t1'},{type:'object',id:'i1'},{type:'object',id:'i2'}];
  const page=renderPublishedPage(note);
  assert.match(page,/<th scope="col">Year<\/th>/);
  assert.match(page,/<caption>Annual figures<\/caption>/);
  assert.match(page,/<td class="numeric">2,500<\/td>/);
  assert.match(page,/src="img\/numbers\/i1.png" alt="A chart"/);
  assert.match(page,/class="caption-side"/);
  assert.match(page,/Figure <em>one<\/em> with <a href="https:\/\/example.org\/source">source<\/a>\./);
  assert.match(page,/class="fullwidth caption-below"/);
  assert.match(page,/src="https:\/\/images.example.org\/chart.jpg" alt="External chart"/);
  assert.throws(()=>renderPublishedPage({...note,objects:{t1:{type:'table',tsv:'A\n'+Array.from({length:1001},()=>1).join('\n')}}}),/1,000 data rows/);
  const template='<!doctype html><html><body><ul class="notes-list"></ul></body></html>';
  const once=updateIndex(template,note),twice=updateIndex(once,note);
  assert.equal((twice.match(/data-note-slug="numbers"/g)||[]).length,1);
  assert.match(twice,/href="numbers.html"/);
});

test('credential and local recovery are encrypted with the passphrase',async()=>{
  const {record,key}=await createCredential('github-token-example','six-words-is-only-an-example-passphrase');
  assert.doesNotMatch(JSON.stringify(record),/github-token-example|six-words/);
  const unlocked=await unlockCredential(record,'six-words-is-only-an-example-passphrase');
  assert.equal(unlocked.token,'github-token-example');
  await assert.rejects(unlockCredential(record,'incorrect-password'),/Incorrect passphrase/);
  const doc=newNote();doc.title='A local paragraph';
  await recoveryPut(doc.id,doc,key);
  const records=await recoveryAll(unlocked.key);
  assert.equal(records.find(r=>r.id===doc.id).document.title,'A local paragraph');
  assert.equal((await recoveryAll(await createCredential('other','another-long-example-passphrase').then(x=>x.key))).length,0);
});

test('GitHub draft save uses the selected branch and rejects an intervening change',async()=>{
  class Fake extends GitHub {
    constructor() {super('test');this.files=new Map();this.writes=0;}
    async ensureDraftBranch() {}
    async file(path) {return this.files.get(path)||null;}
    async writeFile(path,text,branch,sha) {
      assert.equal(branch,'drafts');
      assert.equal(sha,this.files.get(path)?.sha);
      this.writes++;this.files.set(path,{sha:`sha-${this.writes}`,text});
      return {content:{sha:`sha-${this.writes}`},commit:{author:{date:'2026-09-13T12:00:00Z'}}};
    }
  }
  const fake=new Fake(),doc=newNote();doc.slug='example';
  await fake.saveDraft(doc);
  assert.equal(fake.writes,1);assert.equal(doc.remoteSha,'sha-1');
  assert.match(fake.files.get('drafts/example.json').text,/"slug": "example"/);
  fake.files.set('drafts/example.json',{sha:'another-device',text:'{}'});
  await assert.rejects(fake.saveDraft(doc),/changed elsewhere/);
  assert.equal(fake.writes,1);
  assert.equal(utf8Base64('é'),'w6k=');
});

test('publication writes the article, index, and images in one fast-forward commit',async()=>{
  class Fake extends GitHub {
    constructor() {super('test');this.writes=[];this.publicPage=null;}
    async file(path) {
      if(path==='index.html') return {text:'<!doctype html><html><body><ul class="notes-list"></ul></body></html>'};
      if(path==='numbers.html') return this.publicPage;
      throw new Error(`Unexpected file: ${path}`);
    }
    async ref() {return {object:{sha:'main-sha'}};}
    async request(path,options={}) {
      this.writes.push({path,...options});
      if(path==='/git/commits/main-sha') return {tree:{sha:'base-tree'}};
      if(path==='/git/blobs') return {sha:'image-blob'};
      if(path==='/git/trees') return {sha:'next-tree'};
      if(path==='/git/commits') return {sha:'next-commit'};
      if(path==='/git/refs/heads/main') return {};
      throw new Error(`Unexpected request: ${path}`);
    }
  }
  const fake=new Fake(),doc=newNote();doc.slug='numbers';doc.title='Numbers';doc.publicationDate='2026-09-13';
  doc.objects.img={type:'image',data:'data:image/png;base64,aGVsbG8=',alt:'Chart'};
  doc.objects.remote={type:'image',data:'https://images.example.org/remote.png',external:true,alt:'Remote'};
  doc.blocks=[{type:'p',html:'A new article.'},{type:'object',id:'img'},{type:'object',id:'remote'}];
  await fake.publish(doc);
  const tree=fake.writes.find(write=>write.path==='/git/trees');
  assert.equal(tree.body.base_tree,'base-tree');
  assert.deepEqual(tree.body.tree.map(entry=>entry.path),['numbers.html','index.html',`img/numbers/img.png`]);
  assert.match(tree.body.tree[0].content,new RegExp(`notes-editor-id" content="${doc.id}`));
  assert.match(tree.body.tree[1].content,/href="numbers.html"/);
  assert.equal(tree.body.tree[2].sha,'image-blob');
  assert.equal(tree.body.tree.length,3,'external images remain external and are not uploaded as blobs');
  const commit=fake.writes.find(write=>write.path==='/git/commits');
  assert.deepEqual(commit.body.parents,['main-sha']);
  const update=fake.writes.find(write=>write.path==='/git/refs/heads/main');
  assert.equal(update.body.force,false);
  fake.publicPage={text:'<!doctype html><html><head><title>Handwritten page</title></head></html>'};
  const priorWrites=fake.writes.length;
  await assert.rejects(fake.publish(doc),/belongs to another note/);
  assert.equal(fake.writes.length,priorWrites);
  fake.publicPage={text:renderPublishedPage(doc)};
  await fake.publish(doc);
});

test('large draft JSON is read from the Git blob when GitHub omits inline contents',async()=>{
  class Fake extends GitHub {
    async request(path) {
      if(path.includes('/contents/')) return {sha:'large-sha',content:'',encoding:'none'};
      if(path==='/git/blobs/large-sha') return {content:utf8Base64('{"title":"Large draft"}')};
      throw new Error(`Unexpected request: ${path}`);
    }
  }
  assert.equal((await new Fake('test').file('drafts/large.json','drafts')).text,'{"title":"Large draft"}');
});
