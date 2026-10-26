# Writer

Writer is a static page at `https://barasch.github.io/notes/editor.html`. It creates
Tufte-style Notes and screenplay-style Scripts. Existing handwritten HTML notes remain
outside Writer. The public index does not link to Writer.

## One-time setup

1. Merge or publish the Writer files to `notes/main`, then open the Writer URL.
2. Create a GitHub **fine-grained personal access token** owned by `barasch`.
   Select **Only select repositories → notes, writer-private** and give it
   **Contents: Read and write**. A shorter expiration is safer; replace the token
   in Writer when it expires. No other repository permission is needed.
3. Paste the token into Setup. Generate and keep the suggested random passphrase
   somewhere safe, then select **Set up Writer**. This writes only an encrypted
   token record, `editor-auth.json`, to the public `notes` repository. Note and
   Script source drafts are saved only in the private `writer-private` repository.
   The token and passphrase are never written in plaintext to either repository or
   browser storage. No server or other authenticated service is involved beyond
   GitHub.

Anyone can download the encrypted token record and try guesses offline. The generated
random passphrase protects against this; a reused or guessable password does not.

Setup happens once. Other devices use the same passphrase to unlock the shared
encrypted token record; their *unsaved* work does not sync. Every new tab and reload
asks for the passphrase. **Lock** saves local changes and reloads Writer, clearing the
decrypted token from the tab. If a local save fails, Lock asks before discarding the
tab's only copy of unsaved writing. The token can be rotated from the menu while
unlocked, even after the previous token expires, using a new authorized token. Losing
the passphrase means the encrypted credential and locally recovered drafts cannot be
decrypted; replace `editor-auth.json` manually and set up again.

## Notes

The Note editor places prose in the same narrow column and type as the public notes,
with live references in the margin. The style selector and circular menu remain fixed
at the lower right while the page scrolls. The site header remains fixed at the top;
after a GitHub draft has been saved and the large title scrolls out of view, its title
and subtitle appear compactly in that header.

Use **Style** for body text or headings; the menu adds sidenotes, margin notes, links,
images, pull quotes, and native tables. For a table, paste tab-separated rows from a
spreadsheet or another source. The first row becomes column headings, numeric cells
align right, and Writer supports up to 20 columns and 1,000 data rows. Images may be
uploaded to the repository or displayed from an external HTTPS address. Their captions
are edited directly below or beside the image and support links and inline emphasis.
Side captions move below the image on narrow screens. An external image remains
dependent on its host; publishing does not copy it into the repository.

Command on macOS, or Control on Windows and Linux, combines with B, I, and U for bold,
italic, and underline; K inserts or edits a link; and S saves the GitHub draft. Native
Command/Control-Z, Command/Control-Shift-Z, and Control-Y provide undo and redo. There
is deliberately no keyboard shortcut for Publish.

## Scripts

Choose **New → Script** to open the screenplay editor. Its elements are Act, Scene,
Action, Character, Parenthetical, Dialogue, and Transition. Tab advances through
Scene → Action → Character → Parenthetical → Dialogue; Shift-Tab moves
backwards. Shift-Tab from Scene selects Act, and Tab from Act returns to Scene. Act and
Transition can also be chosen directly without entering the normal cycle.

Return follows the drafting flow: Act → Scene, Scene → Action, Action → Action,
Character → Dialogue, Parenthetical → Dialogue, Dialogue → Action, and
Transition → Scene. Shift-Return inserts a line break inside the current element.
Character cues autocomplete names already present in the script and the authored
extensions `(V.O.)`, `(O.S.)`, `(O.C.)`, and `(OFF)`.

`(CONT'D)` is generated display text, never source text. Writer adds it when the same
character resumes after intervening Action or when dialogue continues across a page,
and removes it as soon as edits remove that condition. A page split also generates
`(MORE)` at the foot of the earlier page. The current pagination model and PDF export
share the same US Letter, 12-point Courier layout.

Select a second adjacent dialogue run and choose **Dual dialogue** to display the two
runs simultaneously; **Separate dialogue** reverses it. The menu also switches between
Page and Pageless views, shows or hides the linked Scene list, enters Focus mode, and
exports Fountain or PDF. Fountain export uses `^` for the second half of dual dialogue.
There is intentionally no title page, Script publishing, RTF export, or Note export.

## Saving and privacy

Focus enters full screen; **Exit focus** or Escape returns to editing controls for both
forms. Local recovery is encrypted in this browser's site storage around one second
after a pause, or at least every five seconds during continuous typing. The circle's
border is green once recovered, yellow while changes are pending, and red with a
warning if recovery fails or is overdue. Local recovery includes images, but it is
specific to this browser and device. Clearing site data removes unsaved local copies.
Keep only one editing tab for a particular document at a time.

**Save** commits JSON source to `writer-private/main`: Notes go under `drafts/notes/`
and Scripts go under `drafts/scripts/`. The initial filename is derived from the title.
If that filename is occupied, Writer appends `-2`, `-3`, and so on. Saving again under
the same title updates the current draft. Changing the title and saving creates a new,
independently identified draft under the title-derived filename while leaving the
preceding draft unchanged. Duplicate displayed titles are allowed and receive numbered
filenames. **Save as** creates an independent copy without changing its displayed title
or the source draft.

The Drafts page shows each form, filename, creation time, and last-saved time, and can
permanently delete a draft after confirmation. Deletion removes both the GitHub source
draft and its local recovery copy but does not remove an already published Note page.
The time above the title shows the last explicit GitHub draft save. Autosaves never
touch GitHub or advance that time.

For Notes only, **Publish** first saves the private editable source draft, then makes
one fast-forward commit to `notes/main` containing the article, image files, and index
entry. Scripts cannot be published. If another device changed a draft, Writer refuses
to overwrite it and keeps the local copy for comparison.

Run `npm ci && npm test` to exercise local recovery, credential encryption, Note and
Script editing, deterministic pagination, exports, draft conflict detection, and Note
publication.
