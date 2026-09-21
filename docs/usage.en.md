# Usage and examples

[日本語](usage.md) | **English**

Fewer repetitive edits. More time to refine your design.

Replace a headline. Swap a photo. Line up a set of shapes. Ask AI to handle everyday Illustrator tasks in the language you already use to describe your work. You set the creative direction and share the hands-on work with AI.

For setup, see the [README Quick Start](../README.en.md#quick-start).

> **Public Beta 0.1.0-beta.1.** A trial release. Try it on a copy of your artwork. Keep Illustrator in the foreground with the screen unlocked. For what is covered, see [Beta scope](../README.en.md#beta-scope).

## Try it without changing your artwork

After setup, open a test document and ask your AI client:

```text
Use Illustrator Studio MCP to describe the open document
and the selected objects. Do not change anything yet.
```

Read tools do not modify Illustrator data. See what the AI can inspect before moving on to a single edit.

1. **Identify the target.** Select the text or shapes and describe what you want to change.
2. **Review the plan.** Check the proposed targets and edits.
3. **Ask it to apply.** Read the result and inspect the artwork in Illustrator.

Save before editing. If you make manual changes after planning, request a fresh plan against that updated state.

## Start with the work you already do

### New campaign copy? Update the text together.

Start with the headlines and labels you would otherwise locate and retype one by one. Replace several single-line text frames together, or change only a particular word or phrase.

```text
Replace the selected single-line headline with "Weekend Special." Keep its size and color. Show me which text will change first.
```

**Change the message while keeping the styling you want to preserve.** You can also adjust the font, size, or tracking within a specified range.

### Hand off alignment and duplication. Keep exploring the layout.

Arrange equal-sized rectangles, duplicate a graphic, or adjust the stacking order. Describe the change, inspect the result, and decide what comes next.

```text
Distribute these four equal-sized rectangles evenly across the row, keeping the outer two in place. Show me the proposed layout before changing anything.
```

Supported operations also include moving, scaling, rotating, grouping, and moving paths between layers. A group can be moved as a whole, but scaling and rotating a group are not supported.

### Updated photo? Replace the link and keep the placement.

Relink to a new image prepared at the same pixel dimensions. The server checks its size and position as well as its layer and stacking order.

```text
Replace the selected linked image with this new JPEG. Check that its pixel dimensions match the original, and keep the current size and position.
```

New linked-image placement is supported too. **Update the photography separately from refining the layout.**

### Create graphic elements you can keep editing.

Circles, polygons, stars, lines, and Bézier curves are created as Illustrator paths you can edit afterward. Point text and swatches can also be created, as can gradients in RGB documents.

```text
I want a circle and a star as decorative elements in the open document. Confirm their placement and size before proceeding.
```

*These are example requests. The AI inspects the artwork and checks whether its text, shapes, and images are supported before proceeding. Unsupported targets are rejected before writing.*

## Get more from your setup

**Move from one edit to a coordinated set.** Replace multiple single-line text frames, or combine text replacement, text size or fill changes, path movement, and path appearance changes on distinct targets in one request. All targets are checked first; an unsupported target is reported before writing begins.

**Say what should change—and what should stay.** "Replace the copy, keeping the size and color" or "swap the image, keeping the size and position" gives the AI a clear editing brief.

**Use it for inspection, too.** Inspect fonts, colors, linked-image state, effective resolution, and print-preflight concerns. Incomplete checks are never treated as a clean pass.

## Keep the original and make variants

Make date, price, or photo variants one at a time without overwriting the original file. There is no dedicated variant tool; combine the existing tools in this order.

1. Open the source file. If it is already open, inspect its current state instead of reopening it.
2. Specify the text and images to replace, and the formatting and placement to retain.
3. Review the plan and apply only supported edits. For consecutive changes, follow the continuous-editing conditions, including a verified backup (effectively up to 1,000 objects).
4. Read back the resulting text, positions, and images, and inspect the artwork in Illustrator.
5. Save under a new, unused filename and check that the source file is unchanged.
6. Close the document before reopening the original for the next variant.

Preview is limited to an unsaved state and an explicit region. Its output cannot be passed directly to image comparison. See the [tool catalog and limits](tools.en.md).

You give each variant's name (its save path) in the request; no naming rule is applied automatically.

```text
Make a dated variant of this original. Change "9/20" to "9/27" and save it as
~/Desktop/banner_0927.ai. Leave the original unchanged, and confirm the targets and save path before you start.
```

**Limits**

- Text replacement covers only single-line point text directly on a layer. Text inside groups, area text, and multi-line text are not supported.
- Image replacement covers only relinking a linked image to a TIFF, JPEG, or PNG with the same pixel dimensions. Embedded images and images with different pixel dimensions are not supported.
- A recipe (`illustrator_run_recipe`) holds only text replacement, text size or fill, moves, and path appearance. Image replacement and save-as are not recipe steps and need their own calls.
- Duplicating or resizing artboards, and size variants, are not supported.

## Requests to copy and try

**Update several headlines together**

```text
Replace the selected single-line headlines using this mapping:
Old: "New product" → New: "Just launched"
Old: "Recommended" → New: "This month's picks"
Keep each headline's size and color.
List the targets and proposed changes, and wait for confirmation before applying.
```

**Emphasize just the words that matter**

```text
Make "Limited offer" larger within the selected single-line text frame.
Check that the other characters and their styling can stay unchanged,
and show me the proposed change.
```

**Inspect the file before print**

```text
Use Illustrator Studio MCP to run print preflight on this document.
Check image resolution, links, fonts, thin strokes, transparency, and overprint.
Separate concerns from checks that could not be completed. Do not change the data.
```

These illustrate usage, not results from a particular production job. Text operations require supported single-line point text; alignment requires supported paths. For targets and limits, see [Tools and supported scope](tools.en.md).
