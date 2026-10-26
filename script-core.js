export const SCRIPT_TYPES = Object.freeze([
  'act', 'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
]);

export const AUTHORED_CHARACTER_EXTENSIONS = Object.freeze([
  '(V.O.)', '(O.S.)', '(O.C.)', '(OFF)',
]);

const ID_RE = /^[a-zA-Z0-9-]{1,80}$/;
const SLUG_RE = /^[a-z0-9-]{1,90}$/;
const CONTINUED_RE = /\s*\(\s*CONT[’']?D\s*\)/giu;
const TRAILING_EXTENSION_RE = /\s+\([^()\r\n]{1,80}\)\s*$/u;

const uuid = () => crypto.randomUUID();

export function newScript() {
  const now = Date.now();
  return {
    version: 1,
    kind: 'script',
    id: uuid(),
    slug: '',
    title: '',
    savedTitle: '',
    remoteSha: null,
    remoteSavedAt: '',
    createdAt: now,
    updatedAt: now,
    blocks: [{id: uuid(), type: 'scene', text: ''}],
  };
}

export function validateScript(value) {
  if (!value || value.version !== 1 || value.kind !== 'script' || !Array.isArray(value.blocks)) {
    throw new Error('This script uses a format the Writer cannot read. No changes were made.');
  }
  if (typeof value.id !== 'string' || !ID_RE.test(value.id)
    || (value.slug && !SLUG_RE.test(value.slug))) {
    throw new Error('This script has an invalid address or identifier. No changes were made.');
  }
  const ids = new Set();
  for (const block of value.blocks) {
    if (!block || !ID_RE.test(block.id || '') || ids.has(block.id)
      || !SCRIPT_TYPES.includes(block.type) || typeof block.text !== 'string'
      || block.text.length > 1_000_000
      || (block.dualWithPrevious != null && typeof block.dualWithPrevious !== 'boolean')) {
      throw new Error('This script contains an invalid element. No changes were made.');
    }
    if (block.dualWithPrevious && block.type !== 'character') {
      throw new Error('Only a Character element can begin the second half of dual dialogue.');
    }
    ids.add(block.id);
  }
  if (!value.blocks.length) value.blocks.push({id: uuid(), type: 'scene', text: ''});
  normalizeScript(value);
  return value;
}

export function normalizeScript(script) {
  for (const block of script.blocks) {
    if (block.type === 'character') block.text = stripManualContinued(block.text);
    if (block.dualWithPrevious && !canDualWithPrevious(script.blocks, script.blocks.indexOf(block))) {
      delete block.dualWithPrevious;
    }
  }
  return script;
}

export function newScriptBlock(type = 'action', text = '') {
  if (!SCRIPT_TYPES.includes(type)) throw new Error(`Unknown Script element: ${type}`);
  return {id: uuid(), type, text: String(text)};
}

export function nextScriptType(type) {
  return ({
    act: 'scene',
    scene: 'action',
    action: 'action',
    character: 'dialogue',
    parenthetical: 'dialogue',
    dialogue: 'action',
    transition: 'scene',
  })[type] || 'action';
}

export function cycleScriptType(type, backwards = false) {
  if (type === 'act') return backwards ? 'act' : 'scene';
  if (type === 'transition') return 'transition';
  const order = ['scene', 'action', 'character', 'parenthetical', 'dialogue'];
  const index = order.indexOf(type);
  if (index < 0) return type;
  if (backwards && index === 0) return 'act';
  return order[Math.max(0, Math.min(order.length - 1, index + (backwards ? -1 : 1)))];
}

export function stripManualContinued(value = '') {
  return String(value).replace(CONTINUED_RE, '').replace(/\s{2,}/g,' ').trimEnd();
}

export function characterIdentity(value = '') {
  let text = stripManualContinued(value).trim();
  while (TRAILING_EXTENSION_RE.test(text)) text = text.replace(TRAILING_EXTENSION_RE, '').trimEnd();
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

export function deriveCharacters(blocks) {
  const names = [];
  const seen = new Set();
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].type !== 'character') continue;
    const name = characterIdentity(blocks[index].text);
    if (!name || seen.has(name)) continue;
    seen.add(name); names.push(name);
  }
  return names;
}

export function deriveScenes(blocks) {
  let ordinal = 0;
  return blocks.flatMap((block, index) => {
    if (block.type !== 'scene' || !block.text.trim()) return [];
    ordinal++;
    return [{id: block.id, index, ordinal, text: block.text.trim().toUpperCase()}];
  });
}

export function dialogueRunAt(blocks, characterIndex) {
  if (blocks[characterIndex]?.type !== 'character') return null;
  let cursor = characterIndex + 1;
  if (blocks[cursor]?.type === 'parenthetical') cursor++;
  if (blocks[cursor]?.type !== 'dialogue') return null;
  return {start: characterIndex, end: cursor, character: blocks[characterIndex]};
}

export function previousDialogueRun(blocks, characterIndex) {
  let end = characterIndex - 1;
  if (blocks[end]?.type !== 'dialogue') return null;
  let start = end - 1;
  if (blocks[start]?.type === 'parenthetical') start--;
  if (blocks[start]?.type !== 'character') return null;
  const run = dialogueRunAt(blocks, start);
  return run?.end === end ? run : null;
}

export function canDualWithPrevious(blocks, characterIndex) {
  return Boolean(dialogueRunAt(blocks, characterIndex) && previousDialogueRun(blocks, characterIndex));
}

export function setDualWithPrevious(blocks, characterIndex, enabled = true) {
  const block = blocks[characterIndex];
  if (block?.type !== 'character') return false;
  if (enabled && !canDualWithPrevious(blocks, characterIndex)) return false;
  if (enabled) block.dualWithPrevious = true;
  else delete block.dualWithPrevious;
  return true;
}

function previousInterruptedRun(blocks, characterIndex) {
  let cursor = characterIndex - 1;
  let actionCount = 0;
  while (cursor >= 0 && blocks[cursor].type === 'action') {
    if (blocks[cursor].text.trim()) actionCount++;
    cursor--;
  }
  if (!actionCount || blocks[cursor]?.type !== 'dialogue') return null;
  let character = cursor - 1;
  if (blocks[character]?.type === 'parenthetical') character--;
  if (blocks[character]?.type !== 'character') return null;
  return dialogueRunAt(blocks, character);
}

export function hasInterruptedContinuation(blocks, characterIndex) {
  const current = blocks[characterIndex];
  const prior = previousInterruptedRun(blocks, characterIndex);
  return Boolean(prior && characterIdentity(prior.character.text)
    && characterIdentity(prior.character.text) === characterIdentity(current?.text));
}

export function displayCharacterCue(blocks, characterIndex, {pageContinued = false} = {}) {
  const text = stripManualContinued(blocks[characterIndex]?.text || '').trim().toUpperCase();
  return `${text}${pageContinued || hasInterruptedContinuation(blocks, characterIndex) ? " (CONT'D)" : ''}`;
}

function forceAction(text) {
  if (!text) return '';
  if (/^(?:INT\.?|EXT\.?|EST\.?|I\/E\.?)(?:\s|$)/iu.test(text)
    || /^[A-Z\d .'-]+ TO:$/.test(text) || /^[@.#=>~]/.test(text)) return `!${text}`;
  return text;
}

function fountainScene(text) {
  const value = text.trim().toUpperCase();
  return /^(?:INT\.?|EXT\.?|EST\.?|I\/E\.?)(?:\s|$)/u.test(value) ? value : `.${value}`;
}

export function scriptToFountain(script) {
  validateScript(structuredClone(script));
  const output = [];
  const pushSeparated = line => {
    if (output.length && output.at(-1) !== '') output.push('');
    output.push(line, '');
  };
  for (let index = 0; index < script.blocks.length; index++) {
    const block = script.blocks[index];
    const text = block.text.trim();
    if (!text) continue;
    if (block.type === 'act') pushSeparated(`# ${text.toUpperCase()}`);
    else if (block.type === 'scene') pushSeparated(fountainScene(text));
    else if (block.type === 'action') pushSeparated(forceAction(text));
    else if (block.type === 'transition') {
      const value = text.toUpperCase();
      pushSeparated(value.endsWith(' TO:') || value === 'FADE OUT.' ? value : `>${value}`);
    } else if (block.type === 'character') {
      if (output.length && output.at(-1) !== '') output.push('');
      output.push(`${displayCharacterCue(script.blocks, index)}${block.dualWithPrevious ? ' ^' : ''}`);
    } else if (block.type === 'parenthetical') {
      const value = text.replace(/^\(+|\)+$/g, '').trim();
      output.push(`(${value})`);
    } else if (block.type === 'dialogue') {
      output.push(text, '');
    }
  }
  while (output.at(-1) === '') output.pop();
  return `${output.join('\n')}\n`;
}
