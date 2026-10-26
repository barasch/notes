import {
  AUTHORED_CHARACTER_EXTENSIONS, canDualWithPrevious, characterIdentity,
  cycleScriptType, deriveCharacters, deriveScenes, dialogueRunAt, displayCharacterCue,
  newScriptBlock, nextScriptType, previousDialogueRun, setDualWithPrevious, stripManualContinued, validateScript,
} from './script-core.js?v=20261026-1';
import {paginateScript, SCRIPT_LAYOUT} from './script-layout.js?v=20261026-1';

const editableTypes=new Set(['act','scene','action','character','parenthetical','dialogue','transition']);

function caretOffset(element) {
  const selection=window.getSelection();
  if(!selection?.rangeCount||!element.contains(selection.anchorNode)) return 0;
  const range=document.createRange();range.selectNodeContents(element);range.setEnd(selection.anchorNode,selection.anchorOffset);
  return range.toString().length;
}

function setCaret(element,offset) {
  const walker=document.createTreeWalker(element,window.NodeFilter.SHOW_TEXT);
  let node,remaining=Math.max(0,offset);
  while((node=walker.nextNode())) {
    if(remaining<=node.length) {
      const range=document.createRange();range.setStart(node,remaining);range.collapse(true);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);element.focus();return;
    }
    remaining-=node.length;
  }
  element.focus();
}

function elementWidth(type,dual=false) {
  if(dual) return SCRIPT_LAYOUT.dual.chars*SCRIPT_LAYOUT.charWidth;
  return (SCRIPT_LAYOUT[type]?.chars||SCRIPT_LAYOUT.action.chars)*SCRIPT_LAYOUT.charWidth;
}

export class ScriptEditor {
  constructor({container,sceneRail,styleSelector,onChange=()=>{},onSelection=()=>{}}) {
    this.container=container;this.sceneRail=sceneRail;this.styleSelector=styleSelector;
    this.onChange=onChange;this.onSelection=onSelection;this.document=null;
    try {this.view=localStorage.getItem('writer-script-view')==='page'?'page':'pageless';}
    catch {this.view='pageless';}
    try {this.scenesVisible=localStorage.getItem('writer-script-scenes')!=='hidden';}
    catch {this.scenesVisible=true;}
    this.suggestion=null;this.renderTimer=null;this.caret=null;
    container.addEventListener('input',event=>this.handleInput(event));
    container.addEventListener('keydown',event=>this.handleKeydown(event));
    container.addEventListener('click',event=>this.handleClick(event));
    document.addEventListener('selectionchange',()=>this.selectionChanged());
  }

  load(document) {
    this.document=validateScript(document);this.render();
  }

  snapshot() { return this.document; }

  blockIndex(id) { return this.document?.blocks.findIndex(block=>block.id===id) ?? -1; }
  block(id) { const index=this.blockIndex(id);return index<0?null:this.document.blocks[index]; }

  activeElement() {
    const selection=window.getSelection(),node=selection?.anchorNode;
    return (node?.nodeType===1?node:node?.parentElement)?.closest?.('[data-script-editable]')||null;
  }

  captureCaret(target=this.activeElement()) {
    if(!target) return null;
    return {blockId:target.dataset.blockId,offset:Number(target.dataset.sourceStart||0)+caretOffset(target)};
  }

  restoreCaret(saved=this.caret) {
    if(!saved)return;
    const candidates=[...this.container.querySelectorAll(`[data-script-editable][data-block-id="${CSS.escape(saved.blockId)}"]`)];
    const target=candidates.find(element=>{
      const start=Number(element.dataset.sourceStart||0),end=Number(element.dataset.sourceEnd??Number.MAX_SAFE_INTEGER);
      return saved.offset>=start&&saved.offset<=end;
    })||candidates.at(-1);
    if(!target)return;
    setCaret(target,saved.offset-Number(target.dataset.sourceStart||0));
  }

  render() {
    if(!this.document)return;
    const saved=this.captureCaret()||this.caret;
    this.container.replaceChildren();
    this.container.classList.toggle('script-page-view',this.view==='page');
    this.container.classList.toggle('script-pageless-view',this.view!=='page');
    if(this.view==='page')this.renderPages(); else this.renderPageless();
    this.renderScenes();this.caret=saved;this.restoreCaret(saved);
  }

  authoredCue(block,index) {
    const cue=stripManualContinued(block.text).trim().toUpperCase();
    const display=displayCharacterCue(this.document.blocks,index);
    return {cue,continued:display.slice(cue.length)};
  }

  editable(block,{text=block.text,start=0,end=block.text.length,className='',style=''}={}) {
    const field=document.createElement('div');
    field.className=`script-text ${className}`.trim();field.contentEditable='true';
    field.spellcheck=!['scene','character','transition'].includes(block.type);
    field.dataset.scriptEditable='true';field.dataset.blockId=block.id;
    field.dataset.sourceStart=String(start);field.dataset.sourceEnd=String(end);
    field.setAttribute('role','textbox');field.setAttribute('aria-label',`${block.type} text`);
    if(style)field.setAttribute('style',style);
    field.textContent=text || '';
    return field;
  }

  renderPageless() {
    const sheet=document.createElement('div');sheet.className='script-continuous';
    for(let index=0;index<this.document.blocks.length;index++) {
      const block=this.document.blocks[index];
      const wrapper=document.createElement('div');wrapper.className=`script-block script-${block.type}`;wrapper.dataset.blockId=block.id;
      if(block.dualWithPrevious)wrapper.classList.add('dual-second');
      if(block.type==='character') {
        const {cue,continued}=this.authoredCue(block,index);
        const field=this.editable(block,{text:cue});wrapper.append(field);
        if(continued){const marker=document.createElement('span');marker.className='generated-continuation';marker.textContent=continued;wrapper.append(marker);}
      } else wrapper.append(this.editable(block));
      sheet.append(wrapper);
    }
    this.container.append(sheet);
    this.decorateDualPairs(sheet);
  }

  refreshGeneratedCues() {
    for(const block of this.document.blocks) {
      if(block.type!=='character')continue;
      const wrapper=this.container.querySelector(`.script-block[data-block-id="${CSS.escape(block.id)}"]`);
      const field=wrapper?.querySelector('[data-script-editable]');if(!wrapper||!field)continue;
      const index=this.blockIndex(block.id),authored=stripManualContinued(block.text).trim().toUpperCase();
      const display=displayCharacterCue(this.document.blocks,index),suffix=display.slice(authored.length);
      let marker=wrapper.querySelector('.generated-continuation');
      if(!suffix){marker?.remove();continue;}
      if(!marker){marker=document.createElement('span');marker.className='generated-continuation';field.after(marker);}
      marker.textContent=suffix;
    }
  }

  decorateDualPairs(sheet) {
    for(const second of [...sheet.querySelectorAll('.dual-second')]) {
      const index=this.blockIndex(second.dataset.blockId);
      const left=previousDialogueRun(this.document.blocks,index),right=dialogueRunAt(this.document.blocks,index);
      const first=sheet.querySelector(`[data-block-id="${CSS.escape(this.document.blocks[left?.start]?.id||'')}"]`);
      const last=sheet.querySelector(`[data-block-id="${CSS.escape(this.document.blocks[right?.end]?.id||'')}"]`);
      if(!first||!last)continue;
      const group=document.createElement('div');group.className='dual-dialogue';
      const leftLane=document.createElement('div'),rightLane=document.createElement('div');
      leftLane.className='dual-lane dual-left';rightLane.className='dual-lane dual-right';group.append(leftLane,rightLane);
      first.before(group);
      const stop=last.nextSibling;let node=first;
      let lane=leftLane;
      while(node&&node!==stop){const next=node.nextSibling;if(node===second)lane=rightLane;lane.append(node);node=next;}
    }
  }

  renderPages() {
    const model=paginateScript(this.document);this.lastPageModel=model;
    for(const page of model.pages) {
      const sheet=document.createElement('section');sheet.className='script-page';sheet.dataset.page=String(page.number);
      const groups=new Map();
      for(const item of page.items) {
        if(item.generated||item.type==='page-number'||item.type==='more'||item.generatedContinued) {
          const generated=document.createElement('div');generated.className=`script-line generated script-${item.type}`;
          generated.textContent=item.text;generated.style.left=`${item.x}pt`;generated.style.top=`${item.y}pt`;sheet.append(generated);continue;
        }
        const key=`${item.blockId}:${item.dualColumn||''}`;
        const group=groups.get(key)||{items:[],block:this.block(item.blockId)};group.items.push(item);groups.set(key,group);
      }
      for(const group of groups.values()) {
        const {block,items}=group;if(!block)continue;
        const start=Math.min(...items.map(item=>item.sourceStart??0));
        const end=Math.max(...items.map(item=>item.sourceEnd??block.text.length));
        const first=items[0],dual=Boolean(first.dualColumn);
        const text=block.type==='character'?stripManualContinued(block.text).trim().toUpperCase():block.text.slice(start,end);
        const field=this.editable(block,{text,start:block.type==='character'?0:start,end:block.type==='character'?block.text.length:end,
          className:`script-line script-${block.type}`,
          style:`left:${first.x}pt;top:${first.y}pt;width:${elementWidth(block.type,dual)}pt;min-height:${items.length*SCRIPT_LAYOUT.lineHeight}pt`});
        sheet.append(field);
        if(block.type==='character') {
          const display=displayCharacterCue(this.document.blocks,this.blockIndex(block.id),{pageContinued:first.generatedContinued});
          const authored=stripManualContinued(block.text).trim().toUpperCase();
          if(display.length>authored.length){const marker=document.createElement('span');marker.className='generated-continuation page-generated';marker.textContent=display.slice(authored.length);marker.style.left=`${first.x+authored.length*SCRIPT_LAYOUT.charWidth}pt`;marker.style.top=`${first.y}pt`;sheet.append(marker);}
        }
      }
      this.container.append(sheet);
    }
  }

  renderScenes() {
    if(!this.sceneRail)return;
    this.sceneRail.hidden=!this.scenesVisible;
    this.sceneRail.replaceChildren();
    const heading=document.createElement('p');heading.className='scene-list-heading';heading.textContent='Scenes';this.sceneRail.append(heading);
    for(const scene of deriveScenes(this.document.blocks)) {
      const button=document.createElement('button');button.type='button';button.dataset.sceneId=scene.id;
      button.innerHTML=`<span>${scene.ordinal}</span> ${scene.text}`;this.sceneRail.append(button);
    }
  }

  updateBlockFromElement(field) {
    const block=this.block(field.dataset.blockId);if(!block)return;
    const start=Number(field.dataset.sourceStart||0),end=Number(field.dataset.sourceEnd??block.text.length);
    let value=field.textContent.replace(/\u00a0/g,' ');
    if(block.type==='character') value=stripManualContinued(value);
    block.text=block.text.slice(0,start)+value+block.text.slice(end);
    field.dataset.sourceEnd=String(start+value.length);
  }

  handleInput(event) {
    const field=event.target.closest('[data-script-editable]');if(!field)return;
    this.updateBlockFromElement(field);this.caret=this.captureCaret(field);this.onChange();
    this.updateSuggestions(field);this.renderScenes();
    if(this.view==='page') {
      clearTimeout(this.renderTimer);this.renderTimer=setTimeout(()=>this.render(),120);
    } else this.refreshGeneratedCues();
  }

  insertAtCaret(field,text) {
    const block=this.block(field.dataset.blockId),start=Number(field.dataset.sourceStart||0);
    const offset=start+caretOffset(field);
    block.text=block.text.slice(0,offset)+text+block.text.slice(offset);
    this.caret={blockId:block.id,offset:offset+text.length};this.onChange();this.render();
  }

  handleKeydown(event) {
    const field=event.target.closest('[data-script-editable]');if(!field)return;
    if(this.suggestion&&this.handleSuggestionKey(event,field))return;
    if(event.key==='Tab'&&!event.altKey&&!event.ctrlKey&&!event.metaKey) {
      event.preventDefault();const block=this.block(field.dataset.blockId);
      const next=cycleScriptType(block.type,event.shiftKey);if(next===block.type)return;
      block.type=next;if(next==='parenthetical'&&!block.text.trim()){block.text='()';this.caret={blockId:block.id,offset:1};}
      else this.caret=this.captureCaret(field);
      delete block.dualWithPrevious;this.onChange();this.render();return;
    }
    if(event.key==='Enter'&&!event.altKey&&!event.ctrlKey&&!event.metaKey) {
      event.preventDefault();
      if(event.shiftKey){this.insertAtCaret(field,'\n');return;}
      const index=this.blockIndex(field.dataset.blockId),block=this.document.blocks[index];
      const offset=Number(field.dataset.sourceStart||0)+caretOffset(field);
      const before=block.text.slice(0,offset),after=block.text.slice(offset);block.text=before;
      const next=newScriptBlock(nextScriptType(block.type),after);
      this.document.blocks.splice(index+1,0,next);this.caret={blockId:next.id,offset:0};this.onChange();this.render();return;
    }
    if(event.key==='ArrowUp'||event.key==='ArrowDown')return;
  }

  suggestionValues(field) {
    const block=this.block(field.dataset.blockId);if(block?.type!=='character')return [];
    const value=field.textContent;
    const names=deriveCharacters(this.document.blocks).filter(name=>name!==characterIdentity(value));
    const base=value.match(/^\s*([^()]*)/)?.[1].trim().toUpperCase()||'';
    const known=deriveCharacters(this.document.blocks).find(name=>name===base);
    if(known&&(value.endsWith('(')||/\s$/.test(value))) {
      return AUTHORED_CHARACTER_EXTENSIONS.filter(extension=>!value.toUpperCase().includes(extension));
    }
    const prefix=characterIdentity(value);
    return prefix?names.filter(name=>name.startsWith(prefix)).slice(0,8):[];
  }

  updateSuggestions(field) {
    this.closeSuggestions();const values=this.suggestionValues(field);if(!values.length)return;
    const list=document.createElement('div');list.className='script-suggestions';list.role='listbox';
    values.forEach((value,index)=>{const button=document.createElement('button');button.type='button';button.role='option';button.dataset.value=value;button.textContent=value;button.classList.toggle('selected',index===0);list.append(button);});
    const parent=field.closest('.script-block,.script-page');
    if(parent?.classList.contains('script-page')) {
      list.style.left=field.style.left;list.style.top=`calc(${field.style.top} + ${field.style.minHeight||'12pt'})`;
    }
    parent?.append(list);this.suggestion={list,values,index:0,field};
  }

  handleSuggestionKey(event,field) {
    if(event.key==='Escape'){event.preventDefault();this.closeSuggestions();return true;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();const delta=event.key==='ArrowDown'?1:-1;
      this.suggestion.index=(this.suggestion.index+delta+this.suggestion.values.length)%this.suggestion.values.length;
      [...this.suggestion.list.children].forEach((child,index)=>child.classList.toggle('selected',index===this.suggestion.index));return true;
    }
    if(event.key==='Enter') {
      event.preventDefault();this.acceptSuggestion(field,this.suggestion.values[this.suggestion.index]);return true;
    }
    return false;
  }

  acceptSuggestion(field,value) {
    const block=this.block(field.dataset.blockId),current=field.textContent;
    if(value.startsWith('(')) block.text=`${current.replace(/[\s(]*$/,'')} ${value}`;
    else block.text=value;
    this.caret={blockId:block.id,offset:block.text.length};this.closeSuggestions();this.onChange();this.render();
  }

  closeSuggestions() {this.suggestion?.list.remove();this.suggestion=null;}

  handleClick(event) {
    const suggestion=event.target.closest('.script-suggestions button');
    if(suggestion){const field=this.suggestion?.field;if(field)this.acceptSuggestion(field,suggestion.dataset.value);return;}
    const scene=event.target.closest('[data-scene-id]');
    if(scene){const field=this.container.querySelector(`[data-script-editable][data-block-id="${CSS.escape(scene.dataset.sceneId)}"]`);field?.scrollIntoView({block:'center'});field?.focus();}
  }

  selectionChanged() {
    const field=this.activeElement();if(!field||!this.container.contains(field))return;
    const block=this.block(field.dataset.blockId);if(!block)return;
    this.styleSelector.value=block.type;this.onSelection(block.type,this.canToggleDual());
  }

  setStyle(type) {
    if(!editableTypes.has(type))return false;
    const field=this.activeElement();if(!field)return false;
    const block=this.block(field.dataset.blockId);if(!block)return false;
    block.type=type;delete block.dualWithPrevious;
    if(type==='parenthetical'&&!block.text.trim()){block.text='()';this.caret={blockId:block.id,offset:1};}
    else this.caret=this.captureCaret(field);
    this.onChange();this.render();return true;
  }

  dialogueCharacterIndex(index) {
    if(this.document.blocks[index]?.type==='character')return index;
    if(this.document.blocks[index]?.type==='parenthetical'&&this.document.blocks[index-1]?.type==='character')return index-1;
    if(this.document.blocks[index]?.type==='dialogue') {
      if(this.document.blocks[index-1]?.type==='character')return index-1;
      if(this.document.blocks[index-1]?.type==='parenthetical'&&this.document.blocks[index-2]?.type==='character')return index-2;
    }
    return -1;
  }

  canToggleDual() {
    const field=this.activeElement();if(!field)return false;
    const character=this.dialogueCharacterIndex(this.blockIndex(field.dataset.blockId));
    return character>=0&&(this.document.blocks[character].dualWithPrevious||canDualWithPrevious(this.document.blocks,character));
  }

  toggleDual() {
    const field=this.activeElement();if(!field)return false;
    const character=this.dialogueCharacterIndex(this.blockIndex(field.dataset.blockId));if(character<0)return false;
    const block=this.document.blocks[character],enable=!block.dualWithPrevious;
    if(!setDualWithPrevious(this.document.blocks,character,enable))return false;
    this.caret=this.captureCaret(field);this.onChange();this.render();return true;
  }

  dualLabel() {
    const field=this.activeElement();if(!field)return 'Dual dialogue';
    const character=this.dialogueCharacterIndex(this.blockIndex(field.dataset.blockId));
    return this.document.blocks[character]?.dualWithPrevious?'Separate dialogue':'Dual dialogue';
  }

  setView(view) {
    if(!['page','pageless'].includes(view)||this.view===view)return;
    this.caret=this.captureCaret();this.view=view;try{localStorage.setItem('writer-script-view',view);}catch{}this.render();
  }

  toggleScenes() {
    this.scenesVisible=!this.scenesVisible;try{localStorage.setItem('writer-script-scenes',this.scenesVisible?'shown':'hidden');}catch{}this.renderScenes();return this.scenesVisible;
  }

  pageModel() { this.lastPageModel=paginateScript(this.document);return this.lastPageModel; }
  focusFirst() {this.container.querySelector('[data-script-editable]')?.focus();}
}
