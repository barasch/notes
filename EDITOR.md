# Notes editor

The editor is a static page at `https://barasch.github.io/notes/editor.html`. It creates
new Tufte-style notes and reopens notes it created. Existing handwritten HTML notes
remain outside the editor. The public index does not link to the editor.

## One-time setup

1. Merge or publish the editor files to `main`, then open the editor URL.
2. Create a GitHub **fine-grained personal access token** owned by `barasch`.
   Select **Only select repositories → notes** and give it **Contents: Read and
   write**. A shorter expiration is safer; replace the token in the editor when
   it expires. No other repository permission is needed.
3. Paste the token into Setup. Generate and keep the suggested random passphrase
   somewhere safe, then select **Set up editor**. This writes only an encrypted
   token record, `editor-auth.json`, to the public `main` branch and creates the
   public `drafts` branch. The token and passphrase are never written in plaintext
   to the repository or browser storage. No server or other authenticated
   service is involved beyond GitHub.

Anyone can download the encrypted token record and try guesses offline. The
generated random passphrase protects against this; a reused or guessable
password does not.

Setup happens once for this repository. Other devices use the same passphrase to
unlock the shared encrypted token record; their *unsaved* work does not sync.
Every new tab and reload asks for the passphrase. **Lock** saves local changes
and reloads the editor, clearing the decrypted token from the tab. If a local
save fails, Lock asks before discarding the tab's only copy of unsaved writing.
The token can be rotated from the editor's `···` menu while unlocked, even after
the previous token expires, using a new authorized token. Losing the passphrase
means the encrypted credential and locally recovered drafts cannot be decrypted;
replace `editor-auth.json` manually and set up again.

## Writing and saving

The editor places prose in the same narrow column and type as the public notes,
with live references in the margin. The style selector and circular menu remain
fixed at the lower right while the page scrolls. The site header remains fixed
at the top; after a GitHub draft has been saved and the large title scrolls out
of view, its title and subtitle appear compactly in that header. Use **Style**
for body text or headings; the menu adds sidenotes, margin notes, links, images,
pull quotes, and native tables. For a table, paste tab-separated rows from a
spreadsheet or another source. The first row becomes column headings, numeric
cells align right, and the editor supports up to 20 columns and 1,000 data rows.
Images may be uploaded to the repository or displayed from an external HTTPS
address. Their captions are edited directly below or beside the image and support
links and inline emphasis. Side captions move below the image on narrow screens.
An external image remains dependent on its host; publishing does not copy it into
the repository.
Focus enters full screen; **Exit focus** or Escape returns to editing controls.

Command on macOS, or Control on Windows and Linux, combines with B, I, and U for
bold, italic, and underline; K inserts or edits a link; and S saves the GitHub
draft. Native Command/Control-Z, Command/Control-Shift-Z, and Control-Y continue
to provide undo and redo. There is deliberately no keyboard shortcut for
Publish.

Local recovery is encrypted in this browser's site storage around one second
after a pause, or at least every five seconds during continuous typing. The
circle's **border** is green once recovered, yellow while changes are pending,
and red with a warning if recovery fails or is overdue. Local recovery includes
images, but it is specific to this browser/device. Clearing site data removes
unsaved local copies. Keep only one editing tab for a particular note at a time.

**Save draft** alone commits a JSON source draft to the `drafts` branch. The
initial filename is derived from the title. If that filename is occupied, the
editor appends `-2`, `-3`, and so on. Saving again under the same title updates
the current draft. Changing the title and saving creates a new, independently
identified draft under the title-derived filename while leaving the preceding
draft unchanged. Duplicate displayed titles are allowed and receive numbered
filenames. **Save as** on the Drafts page asks for a filename and creates an
independent copy without changing its displayed title or the source draft. The
Drafts page displays each filename along with its creation and last-saved times,
and can permanently delete a draft after confirmation.
Deletion removes both the GitHub source draft and its local recovery copy but
does not remove an already published page. The time above the title shows the
last explicit GitHub draft save. Autosaves never touch GitHub or
advance that time. **Publish** first saves the editable source draft, then makes
one fast-forward commit to `main` containing the article, image files, and
index entry. The GitHub Pages site only serves the `main` branch; drafts in the
repository remain publicly browseable. If another device changed a draft, the
editor refuses to overwrite it and keeps the local copy for comparison.

Run `npm ci && npm test` to exercise local recovery, credential encryption,
editing, draft conflict detection, and the publication commit.
