# Hard capture and replay cases

These are static browser fixtures. All data is synthetic and stays in the page.
Reload or use the reset control to start again. Serve the repository over HTTP;
no backend, build, or runtime dependency is needed.

## Appearance

Every page has a light/dark switch at the top right. The initial mode follows
`prefers-color-scheme`, including later OS changes. Clicking the switch saves a
manual choice under `aaforms:theme` in browser storage. **Use OS setting** removes
that override. Other open tabs update too. If storage is blocked, manual switching
still works for the current page.

Both palettes cover the classic form, challenges, expense demo, completion banners,
shadow fields, sandboxed frames, and painted seats. Frame theme messages come only
from the parent window; switching themes does not rebuild frames or clear inputs.
Progress resets do not reset the theme.

Run `check-theme.cjs` with the same Node/Playwright and `CHROMIUM_PATH` setup as
the browser check below. It checks both palettes at desktop/mobile widths, OS
changes, persisted choices, tab updates, frame inheritance, and canvas state.

CSS and JavaScript URLs include `?v=` followed by the first 12 hexadecimal digits
of the asset's SHA-256 hash. Update those references whenever an asset changes,
including shadow-template links and the opaque-frame `new URL(...)` references.
`check-theme.cjs` checks the hashes and dark panel/heading colors. This prevents
new theme markup from reusing the old light-only stylesheet in browser caches.

## Completion and difficulty

The single catalog is ordered by estimated capture/replay difficulty:
classic People List → approval queue → supplier wizard → document amendment →
recycled invoices → canvas seats → closed shadow form → nested opaque portal.
This is a training order, not a claim that every recorder fails in the same order.

- Clicking a link or filling fields does not mark a case complete.
- The classic form completes after **Add Person** successfully saves a valid person.
- Each challenge completes when its submit/save/approve action returns `passed`.
  A checked submission that returns `failed` removes that case's completion mark.
  Native validation failures and cancelled dialogs do not submit a result.
- Completion survives page reloads and browser restarts on the same site origin.
  Draft inputs still follow each fixture's original behavior. Old visited-link data
  is not converted into completion.
- Each existing reset/rebuild/recreate button keeps its fixture behavior and clears
  that case's completion. **Reset progress** on the catalog clears all eight marks;
  it does not erase People List or expense-demo data.
- Open catalog tabs update when another tab completes or resets a case.
- Each case also shows **Completed** or **Not completed** on its own page. This
  status updates after submission, reset, reload, or a progress change in another
  tab. The inner supplier form shows its current result without reading sandboxed
  storage. The classic People List includes **Back to Main Menu** navigation.
- Progress uses one `localStorage` key per case under `aaforms:completed:`. Clearing
  site data removes progress; a different browser or site origin has separate progress.
  If storage is blocked, the page reports that completion cannot be saved.
- The opaque portal relays only its checked result to the top page. Sender windows,
  message type, boolean result, and current frame-run ID are checked. Sandbox
  restrictions remain intact. The standalone open-shadow control does not award
  closed-shadow or opaque-portal completion.

## Catalog review — 2026-09-10

The catalog starts with the classic People List (SAP Style) as the baseline,
followed by seven capture and replay challenges in the same list. The introduction
panel and separate hard-case section were removed.

| Previous fixture | Decision | Reason / replacement |
| --- | --- | --- |
| `case-ab.html`, `case-i.html` | Removed | Ordinary srcdoc and nested frames overlap the stronger opaque-frame portal. |
| `case-c.html`, `case-d.html` | Removed | Runtime creation and changing IDs are covered by the order wizard, which also replaces nodes and delays choices. |
| `case-e.html` | Removed | Open shadow access remains available as the supplier control variant and inside the opaque portal. Closed-root capture is a separate challenge. |
| `case-g.html`, `case-h.html` | Removed | Missing IDs and div buttons alone add little difficulty. Semantic selectors can still work. |
| `case-all.html` | Removed | Stacked earlier techniques without an independent, reliable pass condition; duplicated frame and shadow coverage. |
| `case-f.html` | Rebuilt | A rich-text amendment with locked content, nested markup, event-backed state, and a replaced editing node. |
| `vision-fallback.html` | Rebuilt | Similar invoice records, duplicate buttons, changed row order, explicit confirmation, and a strict approval ledger. Keeps the 1,800 decoys without claiming a guaranteed fallback. |
| `form.html` | Restored as the first catalog entry | The classic starting point; BetterRecorder's documented M0/M1 capture baseline keeps its existing route and selectors. |
| `expense-approval.html`, `expense-rules.js` | Retained outside the catalog | A separate AI Steps business-workflow demo, with languages, policy evaluation, and persisted decisions. |

The first ponytail audit found about 60 removable lines in repeated renderers,
shadow styling, and a radio-selection loop. Removing redundant fixtures supersedes
the first two recommendations. The external baseline and expense contracts remain
unchanged. No new dependency or generic form generator was added.

## Evidence and limits

AA supports open shadow DOM and ordinary cross-domain frames. Its current
[shadow DOM documentation](https://docs.automationanywhere.com/bundle/enterprise-v2019/page/automate-web-apps-that-use-the-shadow-dom-standard.html)
lists closed shadow roots and shadow elements inside nested cross-domain frames
as unsupported. The locally archived official extension `4.3.2.0` also checks
`element.shadowRoot.mode === 'open'` in `HTMLObjectSearch.js:536`.

The [Recorder documentation](https://docs.automationanywhere.com/r/automation-360/cloud-recorder-command)
describes cross-domain frame support. The older fixtures' blanket failure claims
are not proof of a current AA limitation. In particular, `allow-same-origin` in
the removed srcdoc cases does not create the opaque-origin barrier tested here.

| Fixture | Capture or replay obstacle | Expected scope |
| --- | --- | --- |
| [Closed shadow](case-closed.html) | Native fields exist inside `mode: 'closed'`; normal page queries and `host.shadowRoot` cannot reach them. | Documented AA object-capture limit. Keyboard, image, or other privileged paths may still work. |
| [Nested opaque frames](case-opaque.html) | Two sandboxed documents omit `allow-same-origin`; an open shadow root sits in the inner document. Recreating frames discards both documents. | Browser access barrier is testable. Opaque sandbox origins are not the same fixture as two separately hosted domains; exact AA behavior is unverified. |
| [Recycled invoice rows](case-recycled.html) | 120 records share six input nodes. The same ID and element can refer to a different invoice after scrolling. | Tests absent targets and silent wrong-record replay. Context-aware selection can succeed. |
| [Replaced fields](case-remount.html) | Delayed supplier options, replaced form nodes, random IDs, and event-backed draft state. | Tests stale references, waits, and value assignment without events. Semantic selection with correct events can succeed. |
| [Document amendment](case-f.html) | One contenteditable document with locked text and changing nested markup; rebuilding replaces the editor. | Tests text-range editing, stale nodes, and draft events. Whole-document replacement fails the structure check. |
| [Approval queue](vision-fallback.html) | Similar records share button labels; reset reverses and replaces rows; a modal adds another Approve button. | Tests record context, stale coordinates, confirmation scope, and DOM budget pressure. Fallback behavior is tool-dependent. |
| [Canvas reservation](case-canvas.html) | Twelve painted seats share one DOM target. Reversing the layout changes which seat occupies each coordinate. | Per-seat DOM capture has no target. Keyboard and visual selection remain possible. |

These fixtures do not detect or reject automation. A tool that handles the
boundary correctly should pass. Browser tests verify fixture behavior; they do
not establish that AA Capture fails.

## Tasks and pass criteria

1. **Closed shadow:** Enter `Ada Torres`, `Procurement`, `SUP-204`; accept the terms;
   save the supplier. Reload and replay. The result must have `status: "passed"`
   and the exact submitted values. `?root=open` provides the open-root control.
2. **Nested frames:** Complete the same supplier task in the inner frame. Click
   **Recreate frames** and replay. Check the result inside the new inner document.
3. **Recycled rows:** Scroll to `INV-1042`, enter `275.50`, scroll away and back,
   and submit. Only `INV-1042` may be edited. Reset and replay. Reusing the first
   input after scrolling to another invoice must produce `status: "failed"`.
4. **Replaced fields:** Select `Peru`, wait for `Lima Parts`, and continue. Enter
   `PO-2048` and `3` units; place the order. Reset and replay with new IDs. Switch
   regions during loading to test replacement; reset during loading to test cancellation.
5. **Canvas:** Enter `Ada Torres`, select `B3`, and reserve. Clear, reverse the
   layout, and replay. The old coordinates must not silently count as success.
   The result must contain `seat: "B3"` and `status: "passed"`. Also test arrow keys
   plus Space or Enter; the live text reports keyboard position and selection.

6. **Document amendment:** Change only `2` to `3` in the quantity paragraph. Keep
   the locked `Contract CT-2048` header and `Delivery: Lima` unchanged. Save, rebuild,
   and repeat. Exact text, three paragraphs, and the locked header must all survive.
   Assigning DOM text without an input event or replacing the entire document fails.
7. **Approval queue:** Approve only `INV-2048 / Acme Parts / USD 275.50`. Check
   the dialog before confirmation. Reset reverses the rows and generates new button
   IDs. Replay using all three record values. Cancel and Escape must make no approval;
   one wrong approval makes the run fail even if the correct record is approved later.

For a live AA run, record the browser and extension versions, Recorder package,
Bot Agent, capture technology, selected object properties, and fallback settings.
Keep capture success, replay success, wrong-target results, and fallback success
as separate observations. Use the existing BetterRecorder acceptance matrix from
the AA KB if testing BetterRecorder; this fixture work does not replace that matrix.

**Live AA acceptance: not run.**

## Runnable browser check

Use an existing Playwright installation and Chromium. The check uses Node's
assertions and does not need a test framework or package manifest in this repo.

```bash
python3 -m http.server 8765 --bind 127.0.0.1
# In another terminal; set NODE_PATH if Playwright is installed outside this repo:
CHROMIUM_PATH=/path/to/compatible/chrome node check-hard-cases.cjs
```

Set `AA_FORMS_URL` to test another local server. Set `AA_SCREENSHOTS` to a disposable
directory to save desktop and mobile screenshots. The check covers positive tasks,
wrong-target failures, frame isolation, node replacement, reset, keyboard use,
mobile overflow, local links, and browser errors.

Validation of the consolidated catalog on 2026-09-10:

- Seven fixtures passed the full browser check in Chromium `121.0.6167.85`.
- Six fixtures also passed in Chromium `152.0.7977.82`, including dialog Cancel/Escape
  and catalog visited/reset checks. The opaque-frame section was omitted from that
  extra run because the installed Playwright cannot track its inner frame on Chromium 151/152.
- Desktop (1280 px) and mobile (390 px) layouts, exact outcomes, negative paths,
  replacements, resets, and document/seat keyboard interactions were checked.
- Documentation links, JavaScript syntax, Git whitespace, and the existing
  expense-rule self-check passed.
- The style detector's catalog-padding warning is a false positive: each link has
  18 px vertical padding inside the list separators. The established Arial font remains.

No sandbox restrictions were disabled. Live AA acceptance and a full screen-reader
pass remain untested. The basic form and expense demo retain their prior behavior;
the basic form is now included in progress checks; the expense demo is not a catalog case.

Progress-tracker validation: all eight cases passed the browser check in Chromium
121, including actual submit outcomes, no completion from visits, classic-form
validation, persistence after reload, same-origin tab updates, local/global reset,
opaque-frame reporting, open-shadow control isolation, and desktop/mobile layouts.
Seven cases also passed in Chromium 152 with the known opaque-frame traversal
limitation excluded. Restoring saved browser state retained completion, and blocked
storage displayed a warning without awarding completion. The check now uses a
bounded timeout for the main browser context.
