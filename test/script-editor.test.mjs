import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {ScriptEditor} from '../script-editor.js';
import {newScript, newScriptBlock} from '../script-core.js';

const scriptEditorSource=readFileSync(new URL('../script-editor.js',import.meta.url),'utf8');

function environment(view='pageless') {
  const dom=new JSDOM('<!doctype html><select id="styles"></select><main id="editor"></main><nav id="scenes"></nav>',{url:'https://example.test/editor.html',pretendToBeVisual:true});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.localStorage=dom.window.localStorage;
  if(view)localStorage.setItem('writer-script-view',view);
  globalThis.CSS={escape:value=>value};
  return dom;
}

test('ScriptEditor defaults to Page view and keeps the empty element created by Enter editable',()=>{
  const dom=environment(null),script=newScript();
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  assert.equal(editor.view,'page');
  assert.ok(document.querySelector('.script-page-view .script-page'));
  let field=document.querySelector('[data-script-editable]');
  field.textContent='INT. ROOM - DAY';placeCaret(field);field.dispatchEvent(new window.Event('input',{bubbles:true}));
  key(field,'Enter');
  assert.equal(script.blocks[1].type,'action');
  field=document.querySelector(`[data-script-editable][data-block-id="${script.blocks[1].id}"]`);
  assert.ok(field,'the empty next element remains visible in Page view');
  assert.notEqual(field.style.left,'');assert.notEqual(field.style.top,'');
  assert.doesNotMatch(scriptEditorSource,/setAttribute\(['"]style['"]/,'page positions must not use CSP-blocked style attributes');
  assert.deepEqual(editor.caret,{blockId:script.blocks[1].id,offset:0});
  editor.setView('pageless');assert.ok(document.querySelector('.script-pageless-view .script-continuous'));
  editor.setView('page');assert.ok(document.querySelector('.script-page-view .script-page'));
  dom.window.close();
});

function placeCaret(field,offset=field.textContent.length) {
  const node=field.firstChild||field.appendChild(document.createTextNode(''));
  const range=document.createRange();range.setStart(node,Math.min(offset,node.length));range.collapse(true);
  window.getSelection().removeAllRanges();window.getSelection().addRange(range);field.focus();
  document.dispatchEvent(new window.Event('selectionchange'));
}

function key(field,key,options={}) {
  field.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
}

test('ScriptEditor follows the element cycle and keeps Act and Transition outside it',()=>{
  const dom=environment(),script=newScript();
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector('[data-script-editable]');placeCaret(field);
  key(field,'Tab',{shiftKey:true});assert.equal(script.blocks[0].type,'act');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Tab');assert.equal(script.blocks[0].type,'scene');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Enter');assert.equal(script.blocks[1].type,'action');
  field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);placeCaret(field);key(field,'Tab');assert.equal(script.blocks[1].type,'character');
  field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);placeCaret(field);key(field,'Tab');assert.equal(script.blocks[1].type,'parenthetical');
  field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);placeCaret(field,1);key(field,'Enter');assert.equal(script.blocks[2].type,'dialogue');
  field=document.querySelector(`[data-block-id="${script.blocks[2].id}"] [data-script-editable]`);placeCaret(field);editor.setStyle('transition');
  field=document.querySelector(`[data-block-id="${script.blocks[2].id}"] [data-script-editable]`);placeCaret(field);key(field,'Enter');assert.equal(script.blocks[3].type,'scene');
  dom.window.close();
});

test('ScriptEditor autocompletes characters and authored extensions while removing manual CONT\'D',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[
    newScriptBlock('character','JOHN'),newScriptBlock('dialogue','Hello.'),
    newScriptBlock('action','He crosses the room.'),newScriptBlock('character','JO'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const current=script.blocks.at(-1);
  let field=document.querySelector(`[data-block-id="${current.id}"] [data-script-editable]`);placeCaret(field);
  field.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.deepEqual(editor.suggestion.values,['JOHN']);key(field,'Enter');assert.equal(current.text,'JOHN');
  field=document.querySelector(`[data-block-id="${current.id}"] [data-script-editable]`);field.textContent='JOHN ';placeCaret(field);
  field.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.ok(editor.suggestion.values.includes('(V.O.)'));
  editor.acceptSuggestion(field,'(V.O.)');assert.equal(current.text,'JOHN (V.O.)');
  field=document.querySelector(`[data-block-id="${current.id}"] [data-script-editable]`);field.textContent="JOHN (CONT'D) (V.O.)";placeCaret(field);
  field.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(current.text,'JOHN (V.O.)');
  dom.window.close();
});

test('ScriptEditor renders complete adjacent dialogue runs in two pageless lanes',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[
    newScriptBlock('character','JOHN'),newScriptBlock('parenthetical','(quietly)'),newScriptBlock('dialogue','The left line.'),
    {...newScriptBlock('character','MARY'),dualWithPrevious:true},newScriptBlock('dialogue','The right line.'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const pair=document.querySelector('.dual-dialogue');
  assert.equal(pair.querySelectorAll('.dual-left .script-dialogue').length,1);
  assert.equal(pair.querySelectorAll('.dual-right .script-dialogue').length,1);
  assert.equal(document.querySelectorAll('.script-continuous > .script-dialogue').length,0);
  dom.window.close();
});
