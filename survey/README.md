# Survey

A live survey for the people in a meeting. One question or a short set of them. Everyone sees the counts and the bars as the votes arrive.

```
index.html     the form and the live results
style.css      the column, the choices, the bars
logic.js       create, vote, tally, close, reopen
app.js         the shared survey and each person's ballot
icon.mjs       the store icon and a fallback cover
build.mjs      packs the Survey app file
```

## What it does

- The person who opens Survey sets it up; everyone else sees who is setting it up, then votes.
- Up to eight questions, and a title if you want one.
- Each question is one choice or any number of choices, with at least two choices, and an optional written answer.
- **Anonymous votes** leaves names off the results. The counts stay.
- **Close survey** stops new votes and leaves the results up. **Reopen** accepts votes again.
- **New survey** starts another one. Earlier ballots stay out of the new counts.

The survey record is the one the meeting can lead. Ballots are each person's own row, so people can still vote while a host is leading the survey. The app does not decide who may start or close it. The meeting does.

## capabilities

| capability | why |
|---|---|
| `db` | The shared survey, the ballots, and who is here. |
| `multiplayer` | The room. |

No network, no wasm, no pointer. `minBuild` is 947.

Collections:

- `survey` read-write — the current survey. Leadable.
- `votes` read-write — one ballot per person. Not leadable.
- `presence` read-write — a short heartbeat. Not leadable.

## Building

```bash
node survey/build.mjs
```

Writes the Survey app file under the site's apps directory. A page shot named `screenshot.png` is kept. The fallback cover is written only when that shot is missing. The store catalog is built from the site repo, not from this tree.

## Licence

MIT. GifOS.
