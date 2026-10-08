# Sign-in motion studies

Step 1 of the [sign-in motion handoff](../../plans/sign-in-motion-ui-handoff.md):
two rough motion studies for direction review. Neither is a selected direction,
and nothing here ships in the app bundle.

| Study | Direction                                                   | Why it is in the pair                                                   |
| ----- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| A     | Discovery Playground with Liquid Layers materials           | The handoff's recommended first prototype                               |
| B     | Liquid Layers (abstract ribbons that align into map layers) | The most materially different option: tests abstraction against objects |

Open `index.html` through any static server (module imports need `http:`), for
example `python -m http.server` in this folder. It loads Three.js 0.183.2 (the
app's pinned version) from jsDelivr.

The toolbar switches study, warm/dark environment, and EN/中文 copy; replays the
entrance; scrubs the timeline with the current storyboard beat; and shows frame
stats (average FPS, p95 interval, share over 33.3ms, DPR). The stage keeps the
real sign-in split (about 62% illustration, 38% form) and prototypes the motion
states from the handoff: pause/resume control remembered for the session, live
reduced-motion still frame, freeze while the form has focus, stop while the tab
is hidden, pointer parallax on fine pointers only, and no WebGL at 800px or less.

All geometry and the map texture are procedural placeholders. There are no
external assets, no text baked into textures (the card label is DOM), no “台”
marker, and no invented events, places, or activity. Frame stats from these
studies are not acceptance measurements.
