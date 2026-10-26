const WIN_ANSI = new Map([
  ['€',128],['‚',130],['ƒ',131],['„',132],['…',133],['†',134],['‡',135],['ˆ',136],['‰',137],
  ['Š',138],['‹',139],['Œ',140],['Ž',142],['‘',145],['’',146],['“',147],['”',148],['•',149],
  ['–',150],['—',151],['˜',152],['™',153],['š',154],['›',155],['œ',156],['ž',158],['Ÿ',159],
]);

function octal(byte) { return `\\${byte.toString(8).padStart(3,'0')}`; }

export function pdfLiteral(value='') {
  let result='';
  for(const character of String(value)) {
    if(character==='\\'||character==='('||character===')') { result+=`\\${character}`;continue; }
    const mapped=WIN_ANSI.get(character);
    if(mapped!=null) { result+=octal(mapped);continue; }
    const code=character.codePointAt(0);
    if(code===10||code===13) { result+=' ';continue; }
    if(code>=32&&code<=126) {result+=character;continue;}
    if(code>=160&&code<=255) {result+=octal(code);continue;}
    result+='?';
  }
  return result;
}

function latin1Bytes(value) {
  const bytes=new Uint8Array(value.length);
  for(let index=0;index<value.length;index++) bytes[index]=value.charCodeAt(index)&255;
  return bytes;
}

export function buildScriptPdf(pageModel) {
  if(!pageModel?.pages?.length) throw new Error('The script has no pages to export.');
  const objects=[];
  const add=(number,body)=>{objects[number]=`${number} 0 obj\n${body}\nendobj\n`;};
  const pageRefs=[];
  add(1,'<< /Type /Catalog /Pages 2 0 R >>');
  add(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  for(let index=0;index<pageModel.pages.length;index++) {
    const pageNumber=4+index*2,contentNumber=pageNumber+1;
    pageRefs.push(`${pageNumber} 0 R`);
    const page=pageModel.pages[index];
    const commands=['BT','/F1 12 Tf'];
    for(const item of page.items) {
      if(!item.text) continue;
      const x=Number(item.x||0).toFixed(2);
      const y=(pageModel.layout.pageHeight-Number(item.y||0)).toFixed(2);
      commands.push(`1 0 0 1 ${x} ${y} Tm (${pdfLiteral(item.text)}) Tj`);
    }
    commands.push('ET');
    const stream=`${commands.join('\n')}\n`;
    add(contentNumber,`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    add(pageNumber,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageModel.layout.pageWidth} ${pageModel.layout.pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`);
  }
  add(2,`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`);
  let document='%PDF-1.4\n%\x80\x81\x82\x83\n';
  const offsets=[0];
  for(let number=1;number<objects.length;number++) {
    offsets[number]=document.length;
    document+=objects[number];
  }
  const xref=document.length;
  document+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let number=1;number<objects.length;number++) {
    document+=`${String(offsets[number]).padStart(10,'0')} 00000 n \n`;
  }
  document+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1Bytes(document);
}

export function downloadScriptPdf(pageModel,filename='script.pdf') {
  const link=document.createElement('a');
  const url=URL.createObjectURL(new Blob([buildScriptPdf(pageModel)],{type:'application/pdf'}));
  link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
