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
  assert.equal(document.querySelector('.script-page-number').textContent,'1.');
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

test('Page view fits and centers its fixed screenplay page within a narrow editor width',()=>{
  const dom=environment(null),script=newScript(),container=document.getElementById('editor');
  Object.defineProperty(container,'clientWidth',{value:360,configurable:true});
  const editor=new ScriptEditor({container,sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const frame=document.querySelector('.script-page-frame'),page=document.querySelector('.script-page');
  assert.equal(frame.style.width,'360px');
  assert.equal(frame.style.height,`${360*792/612}px`);
  assert.match(page.style.transform,/^scale\(0\.44/);
  const transform=page.style.transform;window.dispatchEvent(new window.Event('resize'));
  assert.equal(page.style.transform,transform,'height-only mobile resize does not disturb the page scale');
  dom.window.close();
});

test('the script container is inert while each real block is a separate empty-capable editing host',()=>{
  const dom=environment(null),script=newScript();
  script.blocks=[newScriptBlock('scene','INT. ROOM - DAY'),newScriptBlock('action','')];
  const container=document.getElementById('editor');
  const editor=new ScriptEditor({container,sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const fields=[...document.querySelectorAll('[data-script-editable]')],empty=fields[1];
  assert.equal(container.hasAttribute('contenteditable'),false);
  assert.ok(fields.every(field=>field.getAttribute('contenteditable')==='true'));
  assert.equal(empty.childNodes.length,0,'the application does not seed empty blocks with a structural BR');
  assert.equal(container.querySelectorAll('[data-script-editable]').length,script.blocks.length,'the page adds no trailing placeholder');
  placeCaret(fields[0]);const before=script.blocks.map(block=>block.id);
  container.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
  assert.deepEqual(script.blocks.map(block=>block.id),before,'clicking page whitespace does not change the model');
  assert.equal(container.querySelectorAll('[data-script-editable]').length,script.blocks.length);
  dom.window.close();
});

function placeCaret(field,offset=field.textContent.length) {
  const node=field.firstChild||field.appendChild(document.createTextNode(''));
  const range=document.createRange();range.setStart(node,Math.min(offset,node.length));range.collapse(true);
  field.focus();window.getSelection().removeAllRanges();window.getSelection().addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
}

function key(field,key,options={}) {
  const event=new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});
  field.dispatchEvent(event);return event;
}

function beforeInput(field,inputType,options={}) {
  const {targetRanges,...eventOptions}=options;
  const event=new window.InputEvent('beforeinput',{inputType,bubbles:true,cancelable:true,...eventOptions});
  if(targetRanges)Object.defineProperty(event,'getTargetRanges',{value:()=>targetRanges});
  field.dispatchEvent(event);return event;
}

test('ScriptEditor follows the style cycle while Act and Transition remain explicit styles',()=>{
  const dom=environment(),script=newScript();
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector('[data-script-editable]');placeCaret(field);
  key(field,'Tab',{shiftKey:true});assert.equal(script.blocks[0].type,'act');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Tab');assert.equal(script.blocks[0].type,'scene');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Tab');assert.equal(script.blocks[0].type,'action');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Tab');assert.equal(script.blocks[0].type,'character');
  field=document.querySelector('[data-script-editable]');placeCaret(field);key(field,'Tab');assert.equal(script.blocks[0].type,'parenthetical');
  field=document.querySelector('[data-script-editable]');placeCaret(field,1);key(field,'Tab');assert.equal(script.blocks[0].type,'dialogue');
  editor.setStyle('transition');assert.equal(script.blocks[0].type,'transition');
  dom.window.close();
});

test('Enter applies the nonempty block matrix in Page and Pageless views',()=>{
  for(const view of [null,'pageless']) {
    const cases=[
      {type:'act',text:'ACT I',offset:5,types:['act','scene']},
      {type:'scene',text:'INT. ROOM - DAY',offset:15,types:['scene','action']},
      {type:'action',text:'BeforeAfter',offset:6,types:['action','action'],texts:['Before','After']},
      {type:'character',text:'JOHN',offset:4,types:['character','dialogue']},
      {type:'parenthetical',text:'(quietly)',offset:9,types:['parenthetical','dialogue']},
      {type:'dialogue',text:'Hello world',offset:5,types:['dialogue'],texts:['Hello\n world']},
      {type:'transition',text:'CUT TO:',offset:7,types:['transition','scene']},
    ];
    for(const item of cases) {
      const dom=environment(view),script=newScript();script.blocks=[newScriptBlock(item.type,item.text)];
      const originalId=script.blocks[0].id;
      const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
      editor.load(script);const field=document.querySelector('[data-script-editable]');placeCaret(field,item.offset);
      const event=view==='pageless'?beforeInput(field,'insertParagraph'):key(field,'Enter');
      assert.equal(event.defaultPrevented,true);
      assert.deepEqual(script.blocks.map(block=>block.type),item.types);
      assert.equal(script.blocks[0].id,originalId,'the original block retains its identity');
      if(item.texts)assert.deepEqual(script.blocks.map(block=>block.text),item.texts);
      dom.window.close();
    }

    for(const type of ['act','scene','character','parenthetical','transition']) {
      const dom=environment(view),script=newScript();script.blocks=[newScriptBlock(type,type==='parenthetical'?'(quietly)':'ABCDE')];
      const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
      editor.load(script);const field=document.querySelector('[data-script-editable]');placeCaret(field,2);key(field,'Enter');
      assert.equal(script.blocks.length,1,`${type} does not split internally`);
      assert.equal(script.blocks[0].text,type==='parenthetical'?'(quietly)':'ABCDE');dom.window.close();
    }
  }
});

test('Enter preserves deliberate empty placeholders and applies the empty block matrix',()=>{
  for(const view of [null,'pageless']) {
    const cases=[
      {type:'act',text:'',types:['act']},
      {type:'scene',text:'',types:['scene']},
      {type:'action',text:'',types:['action','character']},
      {type:'character',text:'',types:['character']},
      {type:'parenthetical',text:'()',offset:1,types:['parenthetical','dialogue']},
      {type:'dialogue',text:'',types:['dialogue','action']},
      {type:'transition',text:'',types:['scene'],sameId:true},
    ];
    for(const item of cases) {
      const dom=environment(view),script=newScript();script.blocks=[newScriptBlock(item.type,item.text)];
      const originalId=script.blocks[0].id;
      const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
      editor.load(script);const field=document.querySelector('[data-script-editable]');placeCaret(field,item.offset||0);
      if(view==='pageless')beforeInput(field,'insertParagraph');else key(field,'Enter');
      assert.deepEqual(script.blocks.map(block=>block.type),item.types);
      assert.equal(script.blocks[0].id,originalId);
      if(item.types.length>1)assert.equal(script.blocks[0].text,item.text,'the empty placeholder remains in the model');
      if(item.sameId)assert.equal(script.blocks.length,1);
      editor.setView(view==='pageless'?'page':'pageless');
      assert.deepEqual(script.blocks.map(block=>block.type),item.types,'view changes preserve placeholders');
      dom.window.close();
    }
  }
});

test('Up and Down move between existing script elements while preserving Left and Right for text',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[
    newScriptBlock('scene','INT. ROOM - DAY'),
    newScriptBlock('action','John crosses the room.'),
    newScriptBlock('character','JOHN'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);placeCaret(field,4);
  key(field,'ArrowUp');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[0].id);
  assert.equal(editor.captureCaret().offset,4,'vertical navigation retains the caret column when possible');
  field=editor.activeElement();key(field,'ArrowDown');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[1].id);
  field=editor.activeElement();key(field,'ArrowDown');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[2].id);
  field=editor.activeElement();key(field,'ArrowRight');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[2].id,'horizontal arrows remain within the active element');
  key(field,'ArrowDown');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[2].id,'navigation stops at the final element');
  dom.window.close();
});

test('Up and Down remain native within wrapped elements and cross only at the first or last visual line',()=>{
  const dom=environment(),script=newScript();
  const dialogue=`${'A'.repeat(35)} ${'B'.repeat(35)} ${'C'.repeat(10)}`;
  script.blocks=[
    newScriptBlock('character','JOHN'),
    newScriptBlock('dialogue',dialogue),
    newScriptBlock('action','John crosses the room.'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);

  placeCaret(field,5);
  assert.equal(key(field,'ArrowDown').defaultPrevented,false,'Down remains native on the first of several visual lines');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[1].id);
  key(field,'ArrowUp');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[0].id,'Up crosses from the first visual line');

  field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);
  placeCaret(field,40);
  assert.equal(key(field,'ArrowUp').defaultPrevented,false,'Up remains native on an interior visual line');
  placeCaret(field,40);
  assert.equal(key(field,'ArrowDown').defaultPrevented,false,'Down remains native on an interior visual line');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[1].id);

  placeCaret(field,75);
  assert.equal(key(field,'ArrowUp').defaultPrevented,false,'Up remains native on the last visual line');
  placeCaret(field,75);
  key(field,'ArrowDown');
  assert.equal(editor.activeElement().dataset.blockId,script.blocks[2].id,'Down crosses from the last visual line');
  assert.equal(editor.captureCaret().offset,3,'cross-element navigation preserves the visual column');
  dom.window.close();
});

test('ordinary input retains the active Page-view node when pagination geometry is unchanged',()=>{
  const dom=environment(null),script=newScript();
  script.blocks=[newScriptBlock('action','')];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const field=document.querySelector('[data-script-editable]');
  for(const character of 'Fast mobile input.') {
    field.textContent+=character;placeCaret(field);
    field.dispatchEvent(new window.InputEvent('input',{data:character,inputType:'insertText',bubbles:true}));
    assert.equal(document.querySelector('[data-script-editable]'),field,'typing must not replace the live editable');
  }
  clearTimeout(editor.renderTimer);editor.renderTimer=null;editor.reflowPageAfterInput();
  assert.equal(document.querySelector('[data-script-editable]'),field,'an unchanged page layout needs no reconstruction');
  assert.equal(script.blocks[0].text,'Fast mobile input.');
  dom.window.close();
});

test('Backspace and Delete protect screenplay types, merge Actions, and remove empty blocks',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[newScriptBlock('scene','INT. ROOM - DAY'),newScriptBlock('action','John enters.')];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);placeCaret(field,0);
  assert.equal(key(field,'Backspace').defaultPrevented,true);
  assert.equal(script.blocks.length,2);assert.equal(script.blocks[0].text,'INT. ROOM - DAY');assert.equal(script.blocks[1].text,'John enters.');

  const backward=newScript();backward.blocks=[newScriptBlock('action','One.'),newScriptBlock('action','Two.')];
  const survivorId=backward.blocks[0].id;editor.load(backward);
  field=document.querySelector(`[data-block-id="${backward.blocks[1].id}"] [data-script-editable]`);placeCaret(field,0);
  assert.equal(key(field,'Backspace').defaultPrevented,true);assert.equal(backward.blocks.length,1);
  assert.equal(backward.blocks[0].id,survivorId);assert.equal(backward.blocks[0].text,'One.Two.');

  const forward=newScript();forward.blocks=[newScriptBlock('action','One.'),newScriptBlock('action','Two.')];
  const forwardId=forward.blocks[0].id;editor.load(forward);
  field=document.querySelector(`[data-block-id="${forward.blocks[0].id}"] [data-script-editable]`);placeCaret(field);
  assert.equal(key(field,'Delete').defaultPrevented,true);
  assert.equal(forward.blocks.length,1);assert.equal(forward.blocks[0].id,forwardId);assert.equal(forward.blocks[0].text,'One.Two.');

  const placeholders=newScript();placeholders.blocks=[
    newScriptBlock('scene','INT. ROOM - DAY'),newScriptBlock('action',''),newScriptBlock('character','JOHN'),newScriptBlock('parenthetical','()'),newScriptBlock('dialogue','Hello.'),
  ];
  editor.load(placeholders);const emptyAction=placeholders.blocks[1];
  field=document.querySelector(`[data-block-id="${emptyAction.id}"] [data-script-editable]`);placeCaret(field,0);key(field,'Backspace');
  assert.equal(placeholders.blocks.some(block=>block.id===emptyAction.id),false);assert.equal(editor.activeElement().dataset.blockId,placeholders.blocks[0].id);
  const emptyParenthetical=placeholders.blocks.find(block=>block.type==='parenthetical');
  field=document.querySelector(`[data-block-id="${emptyParenthetical.id}"] [data-script-editable]`);placeCaret(field,1);key(field,'Delete');
  assert.equal(placeholders.blocks.some(block=>block.id===emptyParenthetical.id),false);

  const nextEmpty=newScript();nextEmpty.blocks=[newScriptBlock('action','One.'),newScriptBlock('character','')];editor.load(nextEmpty);
  field=document.querySelector(`[data-block-id="${nextEmpty.blocks[0].id}"] [data-script-editable]`);placeCaret(field);key(field,'Delete');
  assert.equal(nextEmpty.blocks.length,1);assert.equal(nextEmpty.blocks[0].text,'One.');
  dom.window.close();
});

test('mobile beforeinput merges boundaries while Page fragments remain one logical element',()=>{
  const dom=environment(null),script=newScript();
  script.blocks=[newScriptBlock('action','First'),newScriptBlock('action','Second')];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  let field=document.querySelector(`[data-block-id="${script.blocks[1].id}"][data-script-editable]`);placeCaret(field,0);
  field.dispatchEvent(new window.CompositionEvent('compositionstart',{bubbles:true}));
  assert.equal(beforeInput(field,'deleteContentBackward',{isComposing:true}).defaultPrevented,false);
  assert.equal(script.blocks.length,2,'composition input is never converted into a structural merge');
  field.dispatchEvent(new window.CompositionEvent('compositionend',{bubbles:true}));
  assert.equal(beforeInput(field,'deleteContentBackward').defaultPrevented,true);
  assert.equal(script.blocks.length,1);assert.equal(script.blocks[0].text,'FirstSecond');

  const paged=newScript(),dialogue=newScriptBlock('dialogue','word '.repeat(900).trim());
  paged.blocks=[newScriptBlock('character','JOHN'),dialogue];editor.load(paged);
  const fragments=[...document.querySelectorAll(`[data-block-id="${dialogue.id}"][data-script-editable]`)];
  assert.ok(fragments.length>1,'the dialogue spans page fragments');
  const originalLength=dialogue.text.length;field=fragments[1];placeCaret(field,0);
  key(field,'Backspace');
  assert.equal(paged.blocks.length,2,'a page fragment boundary does not merge screenplay elements');
  assert.equal(dialogue.text.length,originalLength-1,'the preceding character in the same element is deleted');
  dom.window.close();
});

test('mobile beforeinput can remove an empty host from a range inside that host',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[newScriptBlock('scene','INT. ROOM - DAY'),newScriptBlock('action',''),newScriptBlock('character','JOHN')];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const previous=document.querySelector(`[data-block-id="${script.blocks[0].id}"] [data-script-editable]`);
  const field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);
  const emptyId=script.blocks[1].id;
  placeCaret(previous,previous.textContent.length);
  const targetRange={
    startContainer:field,startOffset:0,endContainer:field,endOffset:0,
  };
  const event=beforeInput(field,'deleteContentBackward',{targetRanges:[targetRange]});
  assert.equal(event.defaultPrevented,true);
  assert.equal(script.blocks.some(block=>block.id===emptyId),false);
  assert.deepEqual(script.blocks.map(block=>block.type),['scene','character']);
  dom.window.close();
});

test('mobile target ranges do not convert selected or within-element deletion into a structural merge',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[newScriptBlock('action','First'),newScriptBlock('action','Second')];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const field=document.querySelector(`[data-block-id="${script.blocks[1].id}"] [data-script-editable]`);
  placeCaret(field,1);
  const node=field.firstChild;
  const event=beforeInput(field,'deleteContentBackward',{targetRanges:[{
    startContainer:node,startOffset:0,endContainer:node,endOffset:1,
  }]});
  assert.equal(event.defaultPrevented,false);
  assert.equal(script.blocks.length,2);

  const selection=document.createRange();selection.setStart(node,0);selection.setEnd(node,2);
  window.getSelection().removeAllRanges();window.getSelection().addRange(selection);
  const selectedEvent=beforeInput(field,'deleteContentBackward',{targetRanges:[{
    startContainer:node,startOffset:0,endContainer:node,endOffset:2,
  }]});
  assert.equal(selectedEvent.defaultPrevented,false);
  assert.equal(script.blocks.length,2);
  dom.window.close();
});

test('ordinary beforeinput remains native when diagnostic target ranges are unavailable',()=>{
  const dom=environment(),script=newScript();
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const field=document.querySelector('[data-script-editable]');
  const event=new window.InputEvent('beforeinput',{inputType:'insertText',data:'a',bubbles:true,cancelable:true});
  Object.defineProperty(event,'getTargetRanges',{value:()=>{throw new Error('target ranges unavailable');}});
  assert.doesNotThrow(()=>field.dispatchEvent(event));assert.equal(event.defaultPrevented,false);
  dom.window.close();
});

test('temporary diagnostics record structure and ranges without authored text',()=>{
  const dom=environment(),script=newScript();
  const privateText='NEVER_RECORD_THIS_SCRIPT_TEXT_8461';script.blocks=[newScriptBlock('action',privateText)];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles'),diagnosticsEnabled:true});
  editor.load(script);const field=document.querySelector('[data-script-editable]');placeCaret(field,3);
  const range={startContainer:field.firstChild,startOffset:3,endContainer:field.firstChild,endOffset:3};
  beforeInput(field,'insertText',{data:'PRIVATE_TYPED_VALUE',targetRanges:[range]});
  field.dispatchEvent(new window.KeyboardEvent('keydown',{key:'X',code:'KeyX',bubbles:true,cancelable:true}));
  const log=editor.inputDiagnosticLog(),serialized=JSON.stringify(log);
  assert.doesNotMatch(serialized,/NEVER_RECORD_THIS_SCRIPT_TEXT_8461|PRIVATE_TYPED_VALUE|KeyX/);
  assert.ok(log.entries.some(entry=>entry.kind==='event'&&entry.targetRanges?.length===1));
  assert.ok(log.finalModel.blocks.every(block=>Number.isInteger(block.length)&&!('text' in block)));
  dom.window.close();
});

test('temporary diagnostics are disabled by default',()=>{
  const dom=environment(),editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(newScript());
  assert.deepEqual(editor.inputDiagnosticLog(),{enabled:false,entries:[]});
  dom.window.close();
});

test('Backspace does not merge or separate nonempty dual-dialogue boundaries',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[
    newScriptBlock('character','JOHN'),newScriptBlock('dialogue','Left.'),
    {...newScriptBlock('character','MARY'),dualWithPrevious:true},newScriptBlock('dialogue','Right.'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const rightCharacter=script.blocks[2];const field=document.querySelector(`[data-block-id="${rightCharacter.id}"] [data-script-editable]`);placeCaret(field,0);
  key(field,'Backspace');
  assert.equal(script.blocks.length,4);assert.equal(rightCharacter.dualWithPrevious,true);
  assert.equal(rightCharacter.text,'MARY');
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

test('Pageless focus treats directions as dialogue and both sides of dual dialogue as one unit',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[
    newScriptBlock('action','Before.'),
    newScriptBlock('character','JOHN (V.O.)'),newScriptBlock('parenthetical','(quietly)'),newScriptBlock('dialogue','The left line.'),
    {...newScriptBlock('character','MARY (O.S.)'),dualWithPrevious:true},newScriptBlock('parenthetical','(overlapping)'),newScriptBlock('dialogue','The right line.'),
    newScriptBlock('transition','CUT TO:'),
  ];
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);editor.setFocusMode(true);
  const rightDialogue=document.querySelector(`[data-block-id="${script.blocks[6].id}"] [data-script-editable]`);
  let centered=0;rightDialogue.scrollIntoView=options=>{assert.equal(options.block,'center');centered++;};
  placeCaret(rightDialogue);rightDialogue.click();
  assert.ok(centered>0);
  assert.deepEqual(
    [...document.querySelectorAll('.script-block.focus-active')].map(element=>element.dataset.blockId),
    script.blocks.slice(1,7).map(block=>block.id),
  );
  assert.equal(document.querySelector(`[data-block-id="${script.blocks[0].id}"]`).classList.contains('focus-active'),false);
  assert.equal(document.querySelector(`[data-block-id="${script.blocks[7].id}"]`).classList.contains('focus-active'),false);

  const action=document.querySelector(`[data-block-id="${script.blocks[0].id}"] [data-script-editable]`);
  placeCaret(action);action.click();
  assert.deepEqual([...document.querySelectorAll('.script-block.focus-active')].map(element=>element.dataset.blockId),[script.blocks[0].id]);
  editor.setView('page');
  assert.equal(document.querySelectorAll('.focus-active').length,0,'element dimming is limited to Pageless focus');
  dom.window.close();
});

test('Enter recenters the newly active element in Pageless focus',()=>{
  const dom=environment(),script=newScript();
  script.blocks=[newScriptBlock('action','One.')];
  let centeredId='';
  dom.window.HTMLElement.prototype.scrollIntoView=function(options){assert.equal(options.block,'center');centeredId=this.dataset.blockId||centeredId;};
  const editor=new ScriptEditor({container:document.getElementById('editor'),sceneRail:document.getElementById('scenes'),styleSelector:document.getElementById('styles')});
  editor.load(script);
  const field=document.querySelector('[data-script-editable]');placeCaret(field);editor.setFocusMode(true);centeredId='';
  key(field,'Enter');
  assert.equal(centeredId,script.blocks[1].id);
  assert.equal(document.querySelector('.script-block.focus-active').dataset.blockId,script.blocks[1].id);
  dom.window.close();
});
