import test from 'node:test';
import assert from 'node:assert/strict';
import {newScript} from '../script-core.js';
import {paginateScript} from '../script-layout.js';
import {buildScriptPdf,pdfLiteral} from '../script-pdf.js';

const block=(type,text)=>({id:crypto.randomUUID(),type,text});

test('PDF literals escape syntax and encode common screenplay punctuation',()=>{
  assert.equal(pdfLiteral('(A) \\ “B”—C'),String.raw`\(A\) \\ \223B\224\227C`);
});

test('PDF export uses the shared page model and selectable Courier text',()=>{
  const script=newScript();
  script.blocks=[block('scene','INT. ROOM - DAY'),block('action',Array(600).fill('word').join(' '))];
  const layout=paginateScript(script),bytes=buildScriptPdf(layout);
  const pdf=String.fromCharCode(...bytes);
  assert.match(pdf,/^%PDF-1\.4/);
  assert.match(pdf,new RegExp(`/Count ${layout.pageCount} \\>\\>`));
  assert.match(pdf,/\/BaseFont \/Courier/);
  assert.match(pdf,/\/BaseFont \/Courier-Bold/);
  assert.match(pdf,/\/F2 12 Tf\n1 0 0 1 [^\n]+ \(INT\. ROOM - DAY\) Tj/);
  assert.match(pdf,/\(1\.\) Tj/);
  assert.match(pdf,/\(INT\. ROOM - DAY\) Tj/);
  assert.match(pdf,/xref\n0 /);
});
