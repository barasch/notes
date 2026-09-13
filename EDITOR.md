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
with live references in the margin. Use **Style** for body text or headings;
the circular **Insert** menu adds sidenotes, margin notes, links, images, pull
quotes, and native tables. For a table, paste tab-separated rows from a
spreadsheet or another source. The first row becomes column headings, numeric
cells align right, and the editor supports up to 20 columns and 1,000 data rows.
Focus enters full screen; **Exit focus** or Escape returns to editing controls.

Local recovery is encrypted in this browser's site storage around one second
after a pause, or at least every five seconds during continuous typing. The
circle's **border** is green once recovered, yellow while changes are pending,
and red with a warning if recovery fails or is overdue. Local recovery includes
images, but it is specific to this browser/device. Clearing site data removes
unsaved local copies. Keep only one editing tab for a particular note at a time.

**Save draft** alone commits a JSON source draft to the `drafts` branch. The
initial filename is derived from the title in one click; if it is taken or the
title cannot form an address, the editor asks for another. After saving, the
filename stays stable even if the title changes. The time above the
title shows the last explicit GitHub draft save. Autosaves never touch GitHub or
advance that time. **Publish** first saves the editable source draft, then makes
one fast-forward commit to `main` containing the article, image files, and
index entry. The GitHub Pages site only serves the `main` branch; drafts in the
repository remain publicly browseable. If another device changed a draft, the
editor refuses to overwrite it and keeps the local copy for comparison.

Run `npm ci && npm test` to exercise local recovery, credential encryption,
editing, draft conflict detection, and the publication commit.
