# Public Beta 0.1.0-beta.4

[日本語](RELEASE_NOTES.md) | **English**

Published: 2026-09-23 JST (Asia/Tokyo).

An update from 0.1.0-beta.3. It adds adding artboards and switching the active one, renaming, moving and resizing existing ones, PNG/JPEG export of one artboard, and appearance at creation to cut round trips when drawing, and fixes defects. It is not a production-ready release.

**Prerequisite:** keep Illustrator in the foreground with the screen unlocked. In the background or while the screen is locked, most operations are refused.

#### Added

- `illustrator_export`: export one artboard of a saved, unmodified RGB document as one new PNG24 or JPEG file. The source document and file are not changed, and an existing file is never overwritten. Scale 1 or 2, at most 4000 px per side and 12,000,000 px in total, artboards whose edges are whole points; the exported file's pixel size is checked against the plan. An opaque PNG is 1x only. SVG is not supported yet
- `illustrator_reconcile_export`: when `illustrator_export` stops with an indeterminate result, `finalize`, `abandon` and `release_quarantined` are available as allowed at the stop point
- `illustrator_update_artboard` (experimental): plan, apply and read back a rename of an existing artboard, an integer-point move or resize of an inactive one, an active-board switch, or appending a named board. Saved RGB documents only, up to 256 boards, 128 ordinary paths directly on layers and 256 total points; every board origin must be `[0,0]`. Rename, move, resize and adding leave the document unsaved, so save before the next change; an active switch needs no save. This server has no way to remove an added board. Web pixel profiles and edit sessions are unsupported
- `illustrator_create_rectangle` and `illustrator_create_shape` can set opacity, fill and stroke (RGB, CMYK, gray or none) at creation; they are written and read back in the same apply. `illustrator_create_batch` now takes shapes (`create_shape`) and the initial appearance of rectangles and shapes, and its limit rises from 8 to 16 steps (up to 256 shape anchors in total). A layout of about 12 objects takes one plan and one apply

#### Changed

- The published package now depends on `jpeg-js` (BSD-3-Clause), used to decode every exported JPEG and check its pixel size
- Backup's document-structure check now compares the second read of the same document exactly against the first instead of computing its SHA-256 again. The strength of the check and the backup limit (1,000 objects) are unchanged. In one live run, a 600-object backup went from about 18.0 s to about 11.5 s, and a 1,000-object backup took about 18.3 s
- Applying a change during an edit session is about 0.2 s faster per call (a lighter check that Illustrator is in the foreground; median of 5 live runs each)
- Continuous editing was checked live through a CMYK production flow: 62 changes, detection of and recovery from an external change, resend, save and reopen

#### Fixed

- When the check right before apply refuses a change (for example, the target changed after the plan), the result now gives the kind of refusal, the reason, and the next step: plan again and apply with a new `command_id`. Nothing is written, as before. Resending the same `command_id` still returns the previous message
- When a group reference was temporarily unreadable, rolling back a rectangle creation and verifying an edit session could treat the item as absent and report success. When absence cannot be proven, the result is now indeterminate and the edit session does not advance
- A star made by `illustrator_create_shape` stayed selected, changing the user's selection. Stars are now created without changing the selection, like the other shapes
- `illustrator_capture_preview` failed with `PREVIEW_OUTPUT_INVALID` when every pixel in the range was opaque. It now returns the RGB PNG that Illustrator wrote, with `image.pixelFormat` set to `rgb8_opaque`. A range with transparent pixels is RGBA (`rgba8_straight_alpha`) as before
- `illustrator_set_path_appearance` plans did not carry `next_call`
- A backup could fail when the restore-test copy differed from the source by a tiny amount within tolerance, because the comparison read the wrong document
- The description of `illustrator_open_edit_session` now matches what it accepts (up to 2,000 items including nested ones; groups, clip groups, compound paths and linked placed images)
- Setting the fill of an existing object to none with `illustrator_set_path_appearance` was always rolled back on a verification mismatch
- `illustrator_update_artboard` plans now carry `next_call`

#### Known limitations

- Appearance at creation does not support spot colors or gradients. Use `illustrator_set_path_appearance` after creating the object
- Exporting a 4000×3000 px JPEG used about 570 MiB of Node.js memory at peak while checking its size (one measurement)
- Streamable HTTP is covered only by automated tests and AI app connection checks. No Illustrator operation over HTTP has been recorded
- In CMYK documents, stacking-order changes support bring-to-front (`front`) only; compound-path creation is unsupported
- Reading groups can intermittently lose the reference to an item. The cause is unresolved. The operation then stops on the safe side (fails closed), and a result that cannot be confirmed is reported as indeterminate
- Execution records containing long document-identifying information may not be readable
- Existing stroked text is excluded from editing
- The Desktop extension is not signed. Check the author and version in the install dialog
- Always include `@beta` with npm. An install without a tag uses `latest`, which may not be this version

Read [installation](docs/install.en.md), [compatibility](docs/compatibility.en.md), [recovery](docs/runbook.en.md), and the [LICENSE](LICENSE).

Changes in earlier versions are in the [changelog](CHANGELOG.en.md).
