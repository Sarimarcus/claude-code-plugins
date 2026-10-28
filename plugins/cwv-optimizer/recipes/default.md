# Default fix recipes

Framework-neutral edits for the proposals `cwv next` hands out. Each heading is a `fix` name. A project
adds its own recipes (component names, prop conventions, ownership rules) in a file listed under `recipes`
in `cwv.config.json`; where the two disagree, the project file wins.

Only edit files you own. Never edit anything the runner reports under `protectedGlobs`, generated output
(`dist/`, `build/`), `node_modules/`, or config files. If the element is rendered by a dependency, call
`cwv skip` with the reason instead of editing around it.

## lcp-fetchpriority

Trigger: `LCPDiscovery`, or `LCPBreakdown` dominated by load delay. The LCP image is found late or loaded at
normal priority.

Find the LCP element in the evidence file. If it is an image:
- add `fetchpriority="high"` and `loading="eager"` (never `loading="lazy"` on the LCP image);
- if the framework offers a preload slot or prop for the hero image, use it so the browser discovers it from
  the HTML head.

Do not touch images below the first viewport. Do not change image sources or sizes.

## defer-or-async

Trigger: `RenderBlocking`. A first-party script or stylesheet blocks first paint.

- Scripts in `<head>` without `defer`, `async` or `type="module"`: add `defer`, unless it must run before
  first paint (analytics bootstraps, consent, theme-flash guards).
- Extra stylesheets (not the framework's own bundled CSS) that are not needed for the first screen: load them
  with `media="print" onload="this.media='all'"` plus a `<noscript>` fallback.

Never defer the main stylesheet: it flashes unstyled content.

## cls-culprit

Trigger: `CLSCulprits`. Something moves after first paint. Read the evidence file for the culprit nodes.

- Images, iframes and embeds without dimensions: add `width` and `height` (or CSS `aspect-ratio`) matching
  the intrinsic size.
- Late-injected banners or widgets: reserve their space with a fixed `min-height`.
- Web-font swap shifts: only if the framework already declares fonts; otherwise flag it.

If the shift comes from the page structure itself, call `cwv skip` with reason `layout-restructuring`. If the
culprit is already mitigated (fonts with size-adjusted fallbacks, reserved space) and the evidence shows nothing
else, skip with reason `already-mitigated`.

## Flag categories

Insights that no recipe covers are listed for a human: `image-assets` (resize or recompress the files),
`third-party-script` (a business decision), `font-loading`, `architecture` (DOM size, bundles, long tasks).
Never turn a flag into an edit.
