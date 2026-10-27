import {
  dialogueRunAt, displayCharacterCue, previousDialogueRun, validateScript,
} from './script-core.js?v=20261027-3';

export const SCRIPT_LAYOUT = Object.freeze({
  pageWidth: 612,
  pageHeight: 792,
  top: 72,
  bottom: 60,
  lineHeight: 12,
  charWidth: 7.2,
  linesPerPage: 55,
  action: {x:108, chars:60},
  scene: {x:108, chars:60},
  character: {x:266.4, chars:34},
  parenthetical: {x:223.2, chars:30},
  dialogue: {x:180, chars:35},
  transition: {right:540, chars:30},
  dual: {
    leftX:108, rightX:330, chars:27,
    characterInset:50.4, parentheticalInset:21.6, dialogueInset:0,
  },
});

function hardLines(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const result = [];
  let offset = 0;
  for (const part of text.split('\n')) {
    result.push({text:part,start:offset,end:offset+part.length});
    offset += part.length + 1;
  }
  return result;
}

export function wrapScriptText(value, maxChars) {
  const result = [];
  for (const hard of hardLines(value)) {
    if (!hard.text.length) {
      result.push({text:'',start:hard.start,end:hard.end});
      continue;
    }
    let cursor = 0;
    while (cursor < hard.text.length) {
      const remaining = hard.text.slice(cursor);
      if (remaining.length <= maxChars) {
        result.push({text:remaining,start:hard.start+cursor,end:hard.end});
        break;
      }
      const candidate = remaining.slice(0,maxChars+1);
      let width = candidate.lastIndexOf(' ');
      if (width < Math.floor(maxChars*.45)) width=maxChars;
      const text=remaining.slice(0,width).trimEnd();
      result.push({text,start:hard.start+cursor,end:hard.start+cursor+width});
      cursor += width;
      while (hard.text[cursor] === ' ') cursor++;
    }
  }
  return result.length ? result : [{text:'',start:0,end:0}];
}

function runParts(blocks, run, {dual=false, pageContinued=false}={}) {
  const character=blocks[run.start];
  const parenthetical=blocks[run.start+1]?.type==='parenthetical'?blocks[run.start+1]:null;
  const dialogue=blocks[run.end];
  const chars=dual?SCRIPT_LAYOUT.dual.chars:SCRIPT_LAYOUT.dialogue.chars;
  return {
    character,
    cue: displayCharacterCue(blocks,run.start,{pageContinued}),
    parenthetical,
    parentheticalLines: parenthetical ? wrapScriptText(parenthetical.text,SCRIPT_LAYOUT.parenthetical.chars) : [],
    dialogue,
    dialogueLines:wrapScriptText(dialogue.text,chars),
  };
}

function dualPairs(blocks) {
  const pairs=new Map();
  for(let index=0;index<blocks.length;index++) {
    if(blocks[index].type!=='character'||!blocks[index].dualWithPrevious) continue;
    const right=dialogueRunAt(blocks,index),left=previousDialogueRun(blocks,index);
    if(left&&right) pairs.set(left.start,{left,right});
  }
  return pairs;
}

function itemFor(block,type,text,x,row,extra={}) {
  return {blockId:block?.id||null,type,text,x,row,y:SCRIPT_LAYOUT.top+row*SCRIPT_LAYOUT.lineHeight,...extra};
}

export function paginateScript(source,{includeEmpty=false}={}) {
  const script=validateScript(structuredClone(source));
  const blocks=script.blocks,pairs=dualPairs(blocks);
  const pages=[];
  let page,row;
  const newPage=()=>{
    page={number:pages.length+1,items:[]};pages.push(page);row=0;
    if(page.number>1) page.items.push({type:'page-number',text:`${page.number}.`,x:540,row:-3,y:36,generated:true});
  };
  const remaining=()=>SCRIPT_LAYOUT.linesPerPage-row;
  const ensure=(lines,{fresh=false}={})=>{
    if(fresh&&row>0) newPage();
    else if(lines>remaining()&&row>0) newPage();
  };
  const blank=(count=1)=>{row=Math.min(SCRIPT_LAYOUT.linesPerPage,row+count);};
  const put=(block,type,text,x,extra={})=>{
    if(row>=SCRIPT_LAYOUT.linesPerPage)newPage();
    page.items.push(itemFor(block,type,text,x,row,extra));row++;
  };
  const putWrapped=(block,type,lines,x,extra={})=>{
    for(const line of lines){
      if(row>=SCRIPT_LAYOUT.linesPerPage)newPage();
      put(block,type,line.text,x,{sourceStart:line.start,sourceEnd:line.end,...extra});
    }
  };

  const placeDialogue=(run,{dualColumn=null}={})=>{
    const parts=runParts(blocks,run);
    const payload=[...parts.parentheticalLines.map(line=>({line,type:'parenthetical',block:parts.parenthetical})),
      ...parts.dialogueLines.map(line=>({line,type:'dialogue',block:parts.dialogue}))];
    const min=1+Math.min(2,payload.length);
    if(remaining()<min&&row>0)newPage();
    let cursor=0,continued=false;
    while(cursor<payload.length||!cursor) {
      const cue=displayCharacterCue(blocks,run.start,{pageContinued:continued});
      const x=dualColumn==null?SCRIPT_LAYOUT.character.x:
        (dualColumn==='left'?SCRIPT_LAYOUT.dual.leftX:SCRIPT_LAYOUT.dual.rightX)+SCRIPT_LAYOUT.dual.characterInset;
      put(parts.character,'character',cue,x,{generatedContinued:continued});
      const available=remaining();
      const hasMore=payload.length-cursor>available;
      const take=Math.max(0,Math.min(payload.length-cursor,hasMore?available-1:available));
      for(let count=0;count<take;count++) {
        const entry=payload[cursor++];
        const base=dualColumn==null
          ? (entry.type==='parenthetical'?SCRIPT_LAYOUT.parenthetical.x:SCRIPT_LAYOUT.dialogue.x)
          : (dualColumn==='left'?SCRIPT_LAYOUT.dual.leftX:SCRIPT_LAYOUT.dual.rightX)
            +(entry.type==='parenthetical'?SCRIPT_LAYOUT.dual.parentheticalInset:SCRIPT_LAYOUT.dual.dialogueInset);
        put(entry.block,entry.type,entry.line.text,base,{sourceStart:entry.line.start,sourceEnd:entry.line.end});
      }
      if(cursor<payload.length) {
        put(parts.character,'more','(MORE)',dualColumn==null?SCRIPT_LAYOUT.parenthetical.x:x,{generated:true});
        newPage();continued=true;
      } else break;
    }
  };

  const placeDual=(pair)=>{
    const makeLane=run=>{
      const parts=runParts(blocks,run,{dual:true});
      return {run,parts,payload:[...parts.parentheticalLines.map(line=>({line,type:'parenthetical',block:parts.parenthetical})),
        ...parts.dialogueLines.map(line=>({line,type:'dialogue',block:parts.dialogue}))],cursor:0,continued:false};
    };
    const left=makeLane(pair.left),right=makeLane(pair.right);
    const fullHeight=1+Math.max(left.payload.length,right.payload.length);
    if(fullHeight>remaining()&&fullHeight<=SCRIPT_LAYOUT.linesPerPage&&row>0)newPage();
    while(left.cursor<left.payload.length||right.cursor<right.payload.length) {
      if(remaining()<3&&row>0)newPage();
      const startRow=row;
      const cue=(lane,column)=>put(lane.parts.character,'character',
        displayCharacterCue(blocks,lane.run.start,{pageContinued:lane.continued}),
        (column==='left'?SCRIPT_LAYOUT.dual.leftX:SCRIPT_LAYOUT.dual.rightX)+SCRIPT_LAYOUT.dual.characterInset,
        {dualColumn:column,generatedContinued:lane.continued});
      cue(left,'left'); row=startRow; cue(right,'right');
      const payloadStart=row;
      const available=remaining();
      const maxLeft=left.payload.length-left.cursor,maxRight=right.payload.length-right.cursor;
      const hasMore=Math.max(maxLeft,maxRight)>available;
      const take=Math.max(0,Math.min(Math.max(maxLeft,maxRight),hasMore?available-1:available));
      for(let offset=0;offset<take;offset++) {
        const targetRow=payloadStart+offset;
        for(const [lane,column] of [[left,'left'],[right,'right']]) {
          const entry=lane.payload[lane.cursor];
          if(!entry) continue;
          const base=(column==='left'?SCRIPT_LAYOUT.dual.leftX:SCRIPT_LAYOUT.dual.rightX)
            +(entry.type==='parenthetical'?SCRIPT_LAYOUT.dual.parentheticalInset:SCRIPT_LAYOUT.dual.dialogueInset);
          page.items.push(itemFor(entry.block,entry.type,entry.line.text,base,targetRow,
            {dualColumn:column,sourceStart:entry.line.start,sourceEnd:entry.line.end}));
          lane.cursor++;
        }
      }
      row=payloadStart+take;
      const continuingLeft=left.cursor<left.payload.length,continuingRight=right.cursor<right.payload.length;
      if(continuingLeft||continuingRight) {
        if(continuingLeft) page.items.push(itemFor(left.parts.character,'more','(MORE)',SCRIPT_LAYOUT.dual.leftX+SCRIPT_LAYOUT.dual.parentheticalInset,row,{dualColumn:'left',generated:true}));
        if(continuingRight) page.items.push(itemFor(right.parts.character,'more','(MORE)',SCRIPT_LAYOUT.dual.rightX+SCRIPT_LAYOUT.dual.parentheticalInset,row,{dualColumn:'right',generated:true}));
        row++;newPage();left.continued=continuingLeft;right.continued=continuingRight;
      }
    }
  };

  newPage();
  for(let index=0;index<blocks.length;) {
    const block=blocks[index];
    if(!block.text.trim()){
      if(includeEmpty) {
        const config=SCRIPT_LAYOUT[block.type]||SCRIPT_LAYOUT.action;
        if(block.type==='act') {
          ensure(2,{fresh:true});
          put(block,'act','',SCRIPT_LAYOUT.action.x,{sourceStart:0,sourceEnd:0});blank();
        } else if(block.type==='scene') {
          ensure(3);if(row)blank();put(block,'scene','',SCRIPT_LAYOUT.scene.x,{sourceStart:0,sourceEnd:0});blank();
        } else if(block.type==='transition') {
          ensure(2);if(row)blank();
          put(block,'transition','',SCRIPT_LAYOUT.transition.right-SCRIPT_LAYOUT.transition.chars*SCRIPT_LAYOUT.charWidth,{sourceStart:0,sourceEnd:0});blank();
        } else {
          if(row&&block.type!=='action')blank();
          put(block,block.type,'',config.x||SCRIPT_LAYOUT.action.x,{sourceStart:0,sourceEnd:0});
        }
      }
      index++;continue;
    }
    if(pairs.has(index)) {
      if(row)blank();placeDual(pairs.get(index));blank();index=pairs.get(index).right.end+1;continue;
    }
    if(block.type==='character') {
      const run=dialogueRunAt(blocks,index);
      if(run) {if(row)blank();placeDialogue(run);blank();index=run.end+1;continue;}
    }
    if(block.type==='act') {
      ensure(2,{fresh:true});
      const text=block.text.trim().toUpperCase();
      const x=(SCRIPT_LAYOUT.pageWidth-text.length*SCRIPT_LAYOUT.charWidth)/2;
      put(block,'act',text,x);blank();index++;continue;
    }
    if(block.type==='scene') {
      const lines=wrapScriptText(block.text.toUpperCase(),SCRIPT_LAYOUT.scene.chars);
      ensure(lines.length+2);if(row)blank();putWrapped(block,'scene',lines,SCRIPT_LAYOUT.scene.x);blank();index++;continue;
    }
    if(block.type==='transition') {
      const lines=wrapScriptText(block.text.toUpperCase(),SCRIPT_LAYOUT.transition.chars);
      let nextLines=0;
      if(blocks[index+1]?.type==='scene') nextLines=wrapScriptText(blocks[index+1].text,SCRIPT_LAYOUT.scene.chars).length+2;
      ensure(lines.length+nextLines+1);if(row)blank();
      for(const line of lines) put(block,'transition',line.text,
        SCRIPT_LAYOUT.transition.right-line.text.length*SCRIPT_LAYOUT.charWidth,
        {sourceStart:line.start,sourceEnd:line.end});
      blank();index++;continue;
    }
    const config=SCRIPT_LAYOUT[block.type]||SCRIPT_LAYOUT.action;
    const lines=wrapScriptText(block.text,config.chars||SCRIPT_LAYOUT.action.chars);
    if(row&&block.type!=='action')blank();
    putWrapped(block,block.type,lines,config.x||SCRIPT_LAYOUT.action.x);index++;
  }
  while(pages.length>1&&!pages.at(-1).items.some(item=>item.type!=='page-number'))pages.pop();
  return {layout:SCRIPT_LAYOUT,pages,pageCount:pages.length};
}
