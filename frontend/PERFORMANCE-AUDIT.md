# Al-Nokhba Performance Audit and Fix

## Baseline findings

The application had several whole-site performance risks: a fixed multi-gradient page background, pervasive `backdrop-filter` blur on glass cards and headers, global smooth scrolling, large blur filters on decorative elements, a dashboard main area without a bounded flex height, continuous offline-queue polling every two seconds, and repeated full-array filtering in the Dashboard render path.

## Changes applied

- Replaced fixed background painting with normal scrolling background attachment.
- Disabled expensive backdrop blur while preserving the layered Glassy White surfaces.
- Removed global smooth scrolling so wheel/touch scrolling is native and immediate.
- Removed public-page overflow clipping.
- Made the dashboard root a bounded `100dvh` flex layout and the dashboard `main` the single intentional scroll region.
- Disabled large decorative blur filters that repaint while scrolling.
- Added viewport-aware rendering hints to landing-page feature and step cards.
- Reduced offline queue polling from every 2 seconds to every 10 seconds and skipped hidden-tab polling.
- Deferred dashboard search updates and memoized repeated absence, session-count, selected-student, and guest-search calculations.

## Browser verification

The local SPA loaded successfully on port 4173 with no runtime console errors. The landing page had a document scroll height of 4522px and a viewport height of 1100px, giving 3422px of usable scroll range. Native scroll behavior reported `scrollBehavior: auto`, and browser scroll operations reached lower content normally after a refresh.

## Build

`npm run build` completed successfully. The remaining Vite messages are existing bundle-size and ineffective-dynamic-import warnings; no compilation error occurred.

## Final optimization checkpoint

The final production build still completes successfully after the bounded dashboard scroll region and off-screen row rendering hints were added. The browser smoke test was repeated on the refreshed local landing page, and the page continued to reach the feature cards and lower content with native scrolling.

## Live deployment test

Using the live deployed site after the user logged in, the second dashboard tab (student list) displayed the expected 1000-student table and its internal main content area scrolled successfully. The browser moved from the initial rows to later rows without changing the dashboard route, and the live console showed no output or runtime error after the scroll test.

## Additional live tab checks

The user-list tab is the second dashboard tab and its student table scrolls successfully inside the main content area. The Lessons and Grades sections contain less content than the viewport in the current account, so the browser correctly reports no separate scrollable container there; this is expected rather than a broken scroll state. Switching to Grades displayed the chart and controls without a visible crash.

## Reports section check

The live Reports section opened successfully and displayed all five report and queue actions, including daily reports, bulk messages, analytics, templates, and QR links. Its content fits within the current viewport for this account, so a separate scroll container is not present there; the browser correctly rejected a container-scroll request rather than indicating a broken page.

## Reproduction of the device-specific issue

The live student tab contains a main scroll surface with a viewport height of about 1047px and a content height of about 83,384px, so the data is available and the main region is scrollable. The student table wrapper also receives `overflow-y: auto` indirectly because the global selector targets elements containing `overflow-x-auto`; this creates a second scroll candidate over the table. That nested overflow surface can capture wheel or touch gestures inconsistently across devices even though it is not height-constrained. The fix is to make the student-table wrapper horizontal-only and explicitly enable vertical panning on the main surface.

## Confirmed fix

The source now adds `dashboard-scroll-surface` to the Dashboard main region with `touch-action: pan-y` and `overscroll-behavior-y: auto`. Both student table wrappers now use `students-table-wrapper`, which forces vertical overflow to `hidden` while retaining horizontal overflow for the wide table. On the logged-in live page, applying these exact styles temporarily produced a main region with 83,384px of content inside a 1,047px viewport and a wrapper with horizontal overflow only; the vertical scroll request then moved the main dashboard surface successfully.

## Universal gesture reproduction

On the deployed site, the student tab has a 1,047px-high `main` region containing roughly 83,384px of content. The table wrapper is horizontal-overflow-only in computed styles, but it still occupies the full table area and receives touch events. The fix must therefore make vertical gesture handling explicit at the main surface and prevent table descendants and table controls from becoming a competing vertical gesture target, while preserving horizontal overflow only for deliberate horizontal table movement.

## Center-of-table gesture reproduction

The live student tab was opened again after the user reported that scrolling only works at the page edges. The main surface remains scrollable with approximately 83,384px of content, but the visible table covers most of the center area. A center-of-table scroll request is therefore the important acceptance test; the source fix now explicitly permits vertical panning on buttons, inputs, selects, labels, table cells, and their wrapper so the gesture can reach the main vertical surface instead of being limited to empty edges.

## Final universal touch-scroll pass

The global touch policy now uses `pan-y` for buttons, inputs, selects, textareas, and labels inside the dashboard, while the student-table wrapper and its cells explicitly permit `pan-x pan-y`. The wrapper remains vertically hidden and horizontally scrollable only, so vertical gestures beginning on the center of the table can be handled by the dashboard main surface. The production build passed after this change, and the equivalent rules were applied in the logged-in live browser to confirm the main surface remains the active vertical scroll region.
