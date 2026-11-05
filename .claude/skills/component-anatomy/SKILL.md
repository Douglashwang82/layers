---
name: component-anatomy
description: Break a LocalLink UI component into named parts and states with Playwright, and save screenshots plus a selector and style map to docs/design. Use when the user asks to anatomize, dissect, or snapshot a component, or wants reference images to write a more exact prompt for a coding agent.
---

# Component anatomy

The output is reference material for writing exact prompts, not a test. Don't add a spec, and don't change app code. Each file name should be something the user can quote to an agent, and `anatomy.json` tells the agent which selector and source file that name means.

Ask only if the component is unclear. If a name could mean two pieces of markup, capture both.

## 1. Read the code that is there now

- Check `git log -3`. Other work may land while you run, so read the source right before capturing, not from memory.
- From the component's source and `apps/web/src/app/*.css`, list:
  - **Parts:** each element with a class. Use a selector that only matches inside this component.
  - **States:** default, collapsed or expanded, hover, keyboard focus, selected, disabled, empty, error and long text, plus dark, Traditional Chinese and mobile.
- Only capture hover or focus if the CSS has a rule for it. Note the element the rule targets: hover must land on that element.

## 2. Find a running app

- `curl` port 3000 with a generous timeout. A busy dev server can take longer than a few seconds to answer.
- `next dev` refuses to start a second server for this repo. If one is running, use it and leave it running.
- Confirm the database is local without printing credentials. Check `DATABASE_URL` in both the root `.env` and `apps/web/.env.local`.
- Prefer data that already exists. `e2e-seeded-places-*` layers are public and hold the Houston demo places. Don't write to the database for screenshots. If text needs to be longer, change it in the page's DOM.
- Map panel URLs: `/?layers=<slug>,<slug>&view=list` opens the results list. Without `view=list` the panel opens on Your layers. Up to 5 layers can be applied.

## 3. Capture

Use the Playwright MCP browser, `browser_run_code_unsafe`. Copy [capture-template.txt](capture-template.txt) to `.playwright-mcp/capture.js`, fill in its marked section, and run it. It is `.txt` because Prettier would add a trailing `;` to a `.js` file, which breaks the tool. Run it with `filename: ".playwright-mcp/capture.js"`.

Limits of that tool:

- The file must be inside the repo. It refuses the scratchpad.
- Snippets have no `require` or `process`, so they can't write files. `page.screenshot({ path })` still works.
- The template leaves the data on `window.__anatomy`. Save it with `browser_evaluate`, passing `() => window.__anatomy` and `filename: "docs/design/<component>-anatomy/anatomy.json"`.
- Each state needs its own context from `page.context().browser().newContext()`. That's also how you get 2× images, a mobile size, the `locale` cookie and the dark theme.

Output:

```
docs/design/<component>-anatomy/
  anatomy.json
  parts/<component>-<part>.png
  states/<component>-<state>.png
```

No README. Create the folder first.

## 4. Check the images

A file existing doesn't prove it shows the right thing.

- Compare each state with the default using `md5sum` or `cmp`. If the bytes match, the state didn't happen:
  - No CSS rule for it: delete the image and add a reason to `skipped`.
  - There is a rule: redo it, and read the computed style from the element the rule targets to confirm the change.
- Open the riskiest shots, such as mobile, dark and anything scrolled, at reduced scale.
- If a state can't appear in normal use but has CSS, you may add the class in the page. Start its `note` with `FORCED:`.
- Every `image` in `anatomy.json` must exist. List everything not captured in `skipped`, with the reason.

## 5. Finish

- Close the browser, then delete `.playwright-mcp/`. It isn't gitignored.
- Commit only `docs/design/<component>-anatomy/`, staged by path. No push.
- Report the folder, the counts, and everything forced or skipped. Say which commit it was captured from, since the images go stale when the component changes.
