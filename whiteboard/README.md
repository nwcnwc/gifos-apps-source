# Whiteboard

A shared whiteboard for workshops, built on the **[Excalidraw](https://github.com/excalidraw/excalidraw)**
engine (MIT) with a GifOS collaboration layer. Pen and highlighter, sticky
notes, shapes, arrows, frames, clusters, dot voting, a timer, brainstorm and
retrospective templates. Everyone in the meeting or app room edits the same
board live. Export to PowerPoint (one slide per frame), PNG and PDF.

```
index.html                 the shell: #root, script order
style.css                  GifOS bar, right-edge tools, dialogs
shim.js                    in-memory localStorage so upstream does not throw
collab.js                  the room merge and the lost-write net
export.js                  zip / pptx / pdf writers (no libraries)
strings.js                 the English words; build writes it out as i18n/en.json
i18n/*.json                de, es, ru, zh-Hans (en is generated)
app.js                     shell and workshop tools (notes, votes, timer, templates)
vendor.mjs                 rebuilds the engine bundle from the npm pin (needs net)
vendor/                    GENERATED engine + React bundle, CSS, licence notices
build.mjs                  packs all of the above into the App GIF
icon.mjs                   the procedural app icon
test.js                    board, merge and tool tests
test-export.js             pptx / pdf / zip writer tests
test-lib-room.js           room tests against the real room library
```

## How sharing works

Every element has a version and a random tie-breaker. Of two copies of one
element the higher version wins; on a tie the lower tie-breaker wins. That
rule gives the same answer whatever order copies arrive in, so every page
ends up with the same board.

The room stores whole records and the newest arrival wins, so two pages
writing one record could lose a write. So a page only writes rows of its own,
named after the person, a tag for this page load, and the element. Each page
merges all rows itself. A page removes its own row once someone's newer copy
has replaced it, which keeps the room at about one row per element.

A change counts as shared only when the page that shared the app has it. That
page holds the real copy. Anyone else is asking it to take a write. The page
checks the sharer's signed state, and if the write did not arrive it sends
the row again, for as long as it takes. It also checks every update from the
room against its own rows: if one is missing or older than what was sent, the
sharer's state went back, and the row is sent again. Sending a row twice
costs bytes and never changes the result. This is the lost-write net, and the
build checks that it is still in `collab.js`.

## capabilities

| capability | why |
|---|---|
| `db` | The board (`els`), the slide list (`pres`) and small shared facts such as the timer (`meta`). |
| `multiplayer` | Invite and the meeting room: everyone edits the same board. |

No `network`. The board only travels between the people in the room.

## Building

```bash
node whiteboard/vendor.mjs     # only when moving the pin (needs net)
node whiteboard/build.mjs      # -> site/apps/whiteboard/whiteboard.gif
```

Do not run `scripts/build-app-catalog.mjs` from this tree; the catalog is
owned elsewhere.

Tests: `node whiteboard/test.js && node whiteboard/test-export.js`

## Licences

MIT. The notices for Excalidraw and React are packed inside the GIF
(`vendor/COPYING-excalidraw.txt`, `vendor/COPYING-react.txt`).
