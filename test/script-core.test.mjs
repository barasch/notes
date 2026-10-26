import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORED_CHARACTER_EXTENSIONS, canDualWithPrevious, characterIdentity,
  cycleScriptType, deriveCharacters, deriveScenes, displayCharacterCue,
  hasInterruptedContinuation, newScript, newScriptBlock, nextScriptType,
  scriptToFountain, setDualWithPrevious, stripManualContinued, validateScript,
} from '../script-core.js';

const block = (type, text, extra = {}) => ({id: crypto.randomUUID(), type, text, ...extra});

test('script model validates the seven elements and follows keyboard transitions', () => {
  const script = newScript();
  script.blocks = ['act','scene','action','character','parenthetical','dialogue','transition']
    .map(type => block(type, type));
  assert.equal(validateScript(script), script);
  assert.equal(nextScriptType('dialogue'), 'action');
  assert.equal(nextScriptType('transition'), 'scene');
  assert.equal(cycleScriptType('scene', true), 'act');
  assert.equal(cycleScriptType('act'), 'scene');
  assert.equal(cycleScriptType('dialogue'), 'dialogue');
  assert.equal(cycleScriptType('transition'), 'transition');
});

test('character identity removes extension chains and CONT\'D remains computed', () => {
  assert.deepEqual(AUTHORED_CHARACTER_EXTENSIONS, ['(V.O.)','(O.S.)','(O.C.)','(OFF)']);
  assert.equal(characterIdentity("Narrator (V.O.) (CONT'D)"), 'NARRATOR');
  assert.equal(stripManualContinued("NARRATOR (V.O.) (CONT’D)"), 'NARRATOR (V.O.)');
  const blocks = [
    block('character','Narrator (V.O.)'), block('dialogue','One.'),
    block('action','He waits.'),
    block('character',"Narrator (V.O.) (CONT'D)"), block('dialogue','Two.'),
  ];
  assert.equal(hasInterruptedContinuation(blocks,3),true);
  assert.equal(displayCharacterCue(blocks,3),"NARRATOR (V.O.) (CONT'D)");
  blocks.splice(2,1);
  assert.equal(hasInterruptedContinuation(blocks,2),false);
  assert.equal(displayCharacterCue(blocks,2),'NARRATOR (V.O.)');
  blocks.splice(2,0,block('character','OTHER'),block('dialogue','No.'));
  assert.equal(hasInterruptedContinuation(blocks,4),false);
});

test('characters and scenes are derived from current blocks', () => {
  const blocks = [
    block('scene','int. kitchen - day'), block('character','Ada (O.S.)'),
    block('dialogue','Hi.'), block('scene','ext. street - night'),
    block('character','Bert'), block('dialogue','Hello.'), block('character','Ada'),
  ];
  assert.deepEqual(deriveCharacters(blocks),['ADA','BERT']);
  assert.deepEqual(deriveScenes(blocks).map(({ordinal,text})=>({ordinal,text})),[
    {ordinal:1,text:'INT. KITCHEN - DAY'}, {ordinal:2,text:'EXT. STREET - NIGHT'},
  ]);
});

test('dual dialogue pairs only adjacent complete dialogue runs', () => {
  const blocks = [
    block('character','LEFT'), block('dialogue','Left line.'),
    block('character','RIGHT'), block('parenthetical','softly'), block('dialogue','Right line.'),
  ];
  assert.equal(canDualWithPrevious(blocks,2),true);
  assert.equal(setDualWithPrevious(blocks,2,true),true);
  assert.equal(blocks[2].dualWithPrevious,true);
  blocks.splice(2,0,block('action','A beat.'));
  assert.equal(canDualWithPrevious(blocks,3),false);
});

test('Fountain export preserves acts, forced headings, transitions, dual dialogue, and computed continuation', () => {
  const script = newScript();
  script.title='Example';
  script.blocks = [
    block('act','Act One'),
    block('scene','Kitchen - day'),
    block('action','A plain action.'),
    block('character','ALICE'), block('dialogue','First.'),
    block('character','BOB',{dualWithPrevious:true}), block('dialogue','At once.'),
    block('transition','Smash cut'),
    block('scene','INT. HALL - NIGHT'),
    block('character','ALICE (O.S.)'), block('dialogue','Before.'),
    block('action','A door closes.'),
    block('character','ALICE (O.S.)'), block('dialogue','After.'),
  ];
  const fountain=scriptToFountain(script);
  assert.match(fountain,/# ACT ONE/);
  assert.match(fountain,/\.KITCHEN - DAY/);
  assert.match(fountain,/BOB \^\nAt once\./);
  assert.match(fountain,/>SMASH CUT/);
  assert.match(fountain,/ALICE \(O\.S\.\) \(CONT'D\)\nAfter\./);
});
