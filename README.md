# GifOS app source

Source for the applications in the GifOS app store.

This repository is licensed under the Apache License, Version 2.0. That license covers the packaging in this tree. It does not relicense an application. Each directory keeps the license named in its `listing.json` and in its own license file. Ports of other people's work keep the upstream license.

`node test-all.js` runs every `test.js` that exists and lists the applications that do not have one yet.

`listing.json` may set `gifUrl` to an `https` URL of a pinned GitHub Release instead of a GIF built in this tree. It then also sets `gifSha256` and `gifBytes`. The catalog pins that hash. A `gifUrl` of `gifos.app/apps/` is refused: that address is hosting, not a pin.

## Reviews

Anyone with a GitHub account can rate a listed app by pull request. A review is one file, named after your GitHub username, at the root of this repository:

```
<slug>/reviews/<your-github-username>.json
```

```json
{
  "stars": 5,
  "review": "What you think of it — a sentence is plenty.",
  "date": "2026-08-23"
}
```

`stars` is a whole number from 1 to 5. `review` is plain text, up to 1000 characters. `date` is `YYYY-MM-DD`. Exactly those three fields. `<slug>` is the last segment of `gifos.app/store/<slug>`.

On the store listing, **Write a review** opens GitHub's new-file page in that folder with a valid template filled in. Change the filename to `<your-github-username>.json`, then propose the change. GitHub forks the repository for you.

The filename has to be your GitHub login: one review per person per app. Editing or deleting your own file is how you change your mind.

By hand with `gh`:

```bash
gh repo fork nwcnwc/gifos-apps-source --clone && cd gifos-apps-source
USER=$(gh api user -q .login)
mkdir -p "<slug>/reviews"
cat > "<slug>/reviews/$USER.json" <<EOF
{
  "stars": 5,
  "review": "What you think of it — a sentence is plenty.",
  "date": "$(date +%Y-%m-%d)"
}
EOF
git checkout -b "review-<slug>" && git add "<slug>/reviews/$USER.json"
git commit -m "review: <slug>" && git push -u origin "review-<slug>"
gh pr create --fill
```
