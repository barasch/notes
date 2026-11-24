const MAX_ENTRIES=6000;

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

function dimensions(element) {
  if(!element)return null;
  const rect=element.getBoundingClientRect?.();
  return rect?{width:rect.width,height:rect.height,left:rect.left,top:rect.top}:null;
}

export class ScriptInputDiagnostics {
  constructor(editor,{enabled=false}={}) {
    this.enabled=enabled;
    this.editor=editor;this.entries=[];this.dropped=0;this.sequence=0;this.lastSelection='';
    this.sessionId='';this.startedAt='';this.startedClock=0;
  }

  reset() {
    this.entries=[];this.dropped=0;this.sequence=0;this.lastSelection='';
    if(!this.enabled){this.sessionId='';this.startedAt='';this.startedClock=0;return;}
    this.sessionId=sessionId();
    this.startedAt=new Date().toISOString();this.startedClock=globalThis.performance?.now?.()||Date.now();
    this.record('session-start',{view:this.editor.view});
  }

  selection() {
    if(!this.enabled)return null;
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
    if(!this.enabled)return null;
    return {
      view:this.editor.view,caret:this.editor.caret?{...this.editor.caret}:null,
      blocks:(this.editor.document?.blocks||[]).map(block=>({id:block.id,type:block.type,text:block.text,dualWithPrevious:Boolean(block.dualWithPrevious)})),
    };
  }

  record(kind,detail={}) {
    if(!this.enabled)return;
    if(this.entries.length>=MAX_ENTRIES){this.dropped++;return;}
    const clock=globalThis.performance?.now?.()||Date.now();
    this.entries.push({sequence:++this.sequence,ms:Math.round((clock-this.startedClock)*10)/10,kind,...detail});
  }

  recordEvent(event,stage) {
    if(!this.enabled)return;
    const field=elementFor(event.target)?.closest?.('[data-script-editable]');
    const block=this.editor.document?.blocks?.find(item=>item.id===field?.dataset.blockId);
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
      stage,type:event.type,inputType:event.inputType||'',data:event.data??null,
      key:event.key||'',code:event.code||'',cancelable:event.cancelable,defaultPrevented:event.defaultPrevented,
      composing:Boolean(event.isComposing),repeat:Boolean(event.repeat),
      modifiers:{alt:Boolean(event.altKey),ctrl:Boolean(event.ctrlKey),meta:Boolean(event.metaKey),shift:Boolean(event.shiftKey)},
      target:describeNode(event.target),activeElement:describeNode(this.editor.ownerDocument.activeElement),selection:this.selection(),targetRanges,
      blockType:block?.type||null,modelText:block?.text??null,fieldText:field?.textContent??null,
    });
  }

  recordViewport(reason) {
    if(!this.enabled)return;
    const win=this.editor.window,viewport=win.visualViewport,doc=this.editor.ownerDocument;
    const active=doc.activeElement,field=active?.closest?.('[data-script-editable]');
    this.record('viewport',{reason,view:this.editor.view,
      window:{innerWidth:win.innerWidth,innerHeight:win.innerHeight,outerWidth:win.outerWidth,outerHeight:win.outerHeight,devicePixelRatio:win.devicePixelRatio},
      visualViewport:viewport?{width:viewport.width,height:viewport.height,scale:viewport.scale,offsetLeft:viewport.offsetLeft,offsetTop:viewport.offsetTop,pageLeft:viewport.pageLeft,pageTop:viewport.pageTop}:null,
      screen:{width:win.screen?.width,height:win.screen?.height,availWidth:win.screen?.availWidth,availHeight:win.screen?.availHeight,orientation:win.screen?.orientation?.type||''},
      document:{scrollWidth:doc.documentElement.scrollWidth,clientWidth:doc.documentElement.clientWidth,scrollHeight:doc.documentElement.scrollHeight},
      editor:dimensions(this.editor.container),activeField:dimensions(field),activeBlockId:field?.dataset.blockId||null,
    });
  }

  recordSelection() {
    if(!this.enabled)return;
    const selection=this.selection(),signature=JSON.stringify(selection);
    if(signature===this.lastSelection)return;
    this.lastSelection=signature;this.record('selection',{selection});
  }

  export() {
    if(!this.enabled)return {enabled:false,entries:[]};
    const navigator=this.editor.window.navigator,screen=this.editor.window.screen;
    return {
      version:2,privacy:'Contains authored Script Writer text and typed characters; excludes credentials and Note content.',
      entryLimit:MAX_ENTRIES,sessionId:this.sessionId,startedAt:this.startedAt,savedAt:new Date().toISOString(),droppedEntries:this.dropped,
      environment:{
        userAgent:navigator?.userAgent||'',platform:navigator?.platform||'',maxTouchPoints:navigator?.maxTouchPoints||0,
        viewport:{width:this.editor.window.innerWidth,height:this.editor.window.innerHeight,devicePixelRatio:this.editor.window.devicePixelRatio||1,scale:this.editor.window.visualViewport?.scale??null},
        screen:{width:screen?.width||0,height:screen?.height||0,availWidth:screen?.availWidth||0,availHeight:screen?.availHeight||0,orientation:screen?.orientation?.type||''},
      },
      finalModel:this.model(),entries:this.entries,
    };
  }
}
