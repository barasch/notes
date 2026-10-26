import test from 'node:test';
import assert from 'node:assert/strict';
import {newScript} from '../script-core.js';
import {paginateScript, SCRIPT_LAYOUT, wrapScriptText} from '../script-layout.js';

const block=(type,text,extra={})=>({id:crypto.randomUUID(),type,text,...extra});

test('line wrapping is deterministic and respects explicit line breaks',()=>{
  assert.deepEqual(wrapScriptText('one two three',7).map(line=>line.text),['one two','three']);
  assert.deepEqual(wrapScriptText('one\ntwo',20).map(line=>line.text),['one','two']);
});

test('acts start pages and transitions remain with following scenes',()=>{
  const script=newScript();
  script.blocks=[block('action',Array(52).fill('line').join('\n')),block('transition','cut to:'),block('scene','int. room - day'),block('act','act two'),block('scene','ext. road - day')];
  const result=paginateScript(script);
  const transition=result.pages.flatMap(page=>page.items.map(item=>({...item,page:page.number}))).find(item=>item.type==='transition');
  const following=result.pages.flatMap(page=>page.items.map(item=>({...item,page:page.number}))).find(item=>item.type==='scene'&&item.text.includes('ROOM'));
  const act=result.pages.flatMap(page=>page.items.map(item=>({...item,page:page.number}))).find(item=>item.type==='act');
  assert.equal(transition.page,following.page);
  assert.equal(act.row,0);
  assert.ok(result.pageCount>=3);
});

test('dialogue split across pages receives generated MORE and CONT\'D',()=>{
  const script=newScript();
  script.blocks=[block('scene','INT. ROOM - DAY'),block('character','ALICE'),block('dialogue',Array(500).fill('word').join(' '))];
  const result=paginateScript(script);
  const items=result.pages.flatMap(page=>page.items);
  assert.ok(result.pageCount>1);
  assert.ok(items.some(item=>item.type==='more'&&item.text==='(MORE)'));
  assert.ok(items.some(item=>item.type==='character'&&item.text==="ALICE (CONT'D)"));
});

test('interrupted speech continuation is present without changing source',()=>{
  const script=newScript();
  script.blocks=[block('character','ALICE (V.O.)'),block('dialogue','One.'),block('action','A beat.'),block('character','ALICE (V.O.)'),block('dialogue','Two.')];
  const result=paginateScript(script);
  assert.ok(result.pages.flatMap(page=>page.items).some(item=>item.text==="ALICE (V.O.) (CONT'D)"));
  assert.equal(script.blocks[3].text,'ALICE (V.O.)');
});

test('dual dialogue is laid out in parallel columns and can split deterministically',()=>{
  const script=newScript();
  script.blocks=[
    block('character','LEFT'),block('dialogue',Array(400).fill('left').join(' ')),
    block('character','RIGHT',{dualWithPrevious:true}),block('dialogue',Array(400).fill('right').join(' ')),
  ];
  const result=paginateScript(script);
  const items=result.pages.flatMap(page=>page.items);
  assert.ok(items.some(item=>item.dualColumn==='left'));
  assert.ok(items.some(item=>item.dualColumn==='right'));
  assert.ok(items.some(item=>item.dualColumn==='left'&&item.type==='more'));
  assert.ok(items.some(item=>item.dualColumn==='right'&&item.type==='more'));
  assert.ok(items.some(item=>item.dualColumn==='left'&&item.text==="LEFT (CONT'D)"));
  assert.ok(items.some(item=>item.dualColumn==='right'&&item.text==="RIGHT (CONT'D)"));
  assert.equal(SCRIPT_LAYOUT.pageWidth,612);
});
