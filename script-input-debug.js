const MAX_ENTRIES=3000;

function sessionId() {
  return globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function elementFor(node) {
  if(!node)return null;
  return node.nodeType===1?node:node.parentElement;
}

function describeNode(node) {
  const element=elementFor(node),field=element?.closest?.('[data-script-editable]');
  return {
    nodeType:node?.nodeType===3?'text':node?.nodeType===1?'element':node?String(node.nodeType):'none',
    tag:element?.tagName?.toLowerCase()||'',
    id:element?.id||'',
    classes:element?.classList?[...element.classList].filter(name=>name.startsWith('script-')||name.startsWith('dual-')):[],
    blockId:field?.dataset.blockId||'',
    sourceStart:field?Number(field.dataset.sourceStart||0):null,
    sourceEnd:field?Number(field.dataset.sourceEnd||0):null,
    textLength:node?.nodeType===3?node.length:field?.textContent?.length??null,
  };
}

function localOffset(field,node,offset) {
  if(!field||!node||(node!==field&&!field.contains(node)))return null;
  try {
    const range=field.ownerDocument.createRange();range.selectNodeContents(field);range.setEnd(node,offset);
    return range.toString().length;
  } catch {return null;}
}

function point(node,offset) {
  const element=elementFor(node),field=element?.closest?.('[data-script-editable]');
  return {...describeNode(node),domOffset:offset,localOffset:localOffset(field,node,offset)};
}

function keyName(key='') {
  if(key.length===1)return 'printable';
  return key;
}

export class ScriptInputDiagnostics {
  constructor(editor) {
    this.editor=editor;this.entries=[];this.dropped=0;this.sequence=0;this.lastSelection='';
    this.sessionId=sessionId();
    this.startedAt=new Date().toISOString();this.startedClock=globalThis.performance?.now?.()||Date.now();
  }

  reset() {
    this.entries=[];this.dropped=0;this.sequence=0;this.lastSelection='';
    this.sessionId=sessionId();
    this.startedAt=new Date().toISOString();this.startedClock=globalThis.performance?.now?.()||Date.now();
    this.record('session-start',{view:this.editor.view});
  }

  selection() {
    const selection=this.editor.window.getSelection();
    if(!selection?.rangeCount)return {rangeCount:0,collapsed:true};
    const range=selection.getRangeAt(0);
    return {
      rangeCount:selection.rangeCount,collapsed:selection.isCollapsed,
      anchor:point(selection.anchorNode,selection.anchorOffset),focus:point(selection.focusNode,selection.focusOffset),
      start:point(range.startContainer,range.startOffset),end:point(range.endContainer,range.endOffset),
    };
  }

  model() {
    return {
      view:this.editor.view,caret:this.editor.caret?{...this.editor.caret}:null,
      blocks:(this.editor.document?.blocks||[]).map(block=>({id:block.id,type:block.type,length:block.text.length,dualWithPrevious:Boolean(block.dualWithPrevious)})),
    };
  }

  record(kind,detail={}) {
    if(this.entries.length>=MAX_ENTRIES){this.dropped++;return;}
    const clock=globalThis.performance?.now?.()||Date.now();
    this.entries.push({sequence:++this.sequence,ms:Math.round((clock-this.startedClock)*10)/10,kind,...detail});
  }

  recordEvent(event,stage) {
    let targetRanges=[];
    try {
      targetRanges=[...(event.getTargetRanges?.()||[])].map(range=>({
        collapsed:range.startContainer===range.endContainer&&range.startOffset===range.endOffset,
        start:point(range.startContainer,range.startOffset),end:point(range.endContainer,range.endOffset),
      }));
    } catch (error) {
      targetRanges=[{error:error?.name||'unavailable'}];
    }
    this.record('event',{
      stage,type:event.type,inputType:event.inputType||'',dataLength:typeof event.data==='string'?[...event.data].length:null,
      key:keyName(event.key||''),code:event.key?.length===1?'printable':event.code||'',cancelable:event.cancelable,defaultPrevented:event.defaultPrevented,
      composing:Boolean(event.isComposing),repeat:Boolean(event.repeat),
      modifiers:{alt:Boolean(event.altKey),ctrl:Boolean(event.ctrlKey),meta:Boolean(event.metaKey),shift:Boolean(event.shiftKey)},
      target:describeNode(event.target),activeElement:describeNode(this.editor.ownerDocument.activeElement),selection:this.selection(),targetRanges,
    });
  }

  recordSelection() {
    const selection=this.selection(),signature=JSON.stringify(selection);
    if(signature===this.lastSelection)return;
    this.lastSelection=signature;this.record('selection',{selection});
  }

  export() {
    const navigator=this.editor.window.navigator,screen=this.editor.window.screen;
    return {
      version:1,privacy:'No authored text, typed characters, token values, or credentials are recorded.',
      sessionId:this.sessionId,startedAt:this.startedAt,savedAt:new Date().toISOString(),droppedEntries:this.dropped,
      environment:{
        userAgent:navigator?.userAgent||'',platform:navigator?.platform||'',maxTouchPoints:navigator?.maxTouchPoints||0,
        viewport:{width:this.editor.window.innerWidth,height:this.editor.window.innerHeight,devicePixelRatio:this.editor.window.devicePixelRatio||1},
        screen:{width:screen?.width||0,height:screen?.height||0},
      },
      finalModel:this.model(),entries:this.entries,
    };
  }
}
