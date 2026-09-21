# Safety

[日本語](safety.md) | **English**

Illustrator Studio MCP checks the change, not just the command. Planning the edit and verifying its actual result are one flow.

> **Public Beta 0.1.0-beta.1.** A trial release. Try it on a copy of your artwork. Illustrator must be in the foreground with the screen unlocked. In the background or with the screen locked, operations are refused or fail with an unclear reason.

## What to know before editing

- Review the target and plan before asking for an edit. The server checks them again immediately before writing.
- Results are read back from Illustrator. Only the values checked by that operation are verified; inspect visual and print quality yourself.
- Repeated requests return historical execution records, not proof of the document's current state.
- A lost response means an unknown outcome. Stop further edits and follow the [recovery steps](runbook.en.md) rather than retrying blindly.
- Backups check a saved file and defined structural properties. They do not guarantee every appearance effect or external linked asset; keep independent originals.

## Consecutive edits

Continuous editing of saved files (edit sessions, experimental) requires a verified backup and exclusive use of the document. It supports 36 of 39 editing operations; delete, embed, and vector import are excluded. The backup a session needs stops at 1,000 objects, so that is the effective session ceiling (extrapolated from one 600-object live run; 1,000 objects has not been measured). Do not edit the same document through another person or app during the session. Not every external change is detected.

## Known limits

Long document identifiers can make saved execution records unreadable, and some group references intermittently become invalid. Both remain unresolved. Do not delete records, resend the edit as a new request, or assume a restart repaired the problem. [Compatibility](compatibility.en.md) separates verified cases from unverified ones.

<details>
<summary>For connection and recovery work: exact tools and conditions</summary>

## The change flow

Tools that edit objects, layers and similar content (including recipes and batches) follow the shared lifecycle `plan -> preflight -> apply -> verify -> rollback / reconcile`. These tools take a different shape: they have no `apply: false` plan and no `command_id`, and run a preflight and the apply in one call: creating, saving as, saving, opening and closing documents; backup; outlined export; image optimization (it has `apply` but no `command_id`); starting, listing and closing edit sessions; and `illustrator_reconcile_backup` and `illustrator_reconcile_export`. They still bind the document key and read back and verify the result.

```text
Plan      apply: false. Read-only; returns targets, changes, and any blocking reasons
 ↓
Check     right before writing, confirm the document and targets still match the plan
 ↓
Apply     apply: true with a command_id; applied once
 ↓
Verify    read the result back from Illustrator and compare it with the plan
 ↓
Recover   use operation-specific inverse/recovery procedures and check the covered state
          when the result is unknown, block further changes and reconcile
```

- Every change binds an explicit document key (`expected_document_key`) and target identities (such as Illustrator's native `PageItem.uuid`).
- The pre-write check runs in the same Illustrator call that makes the change.
- A returned call alone is never success. Success requires the read-back result to match the plan.

## What you want to know, and how the server handles it

| What you want to know | How the server handles it |
| --- | --- |
| Will it change the wrong text or object? | Binds the document and targets, then checks their state again immediately before writing |
| Can I inspect the change first? | Returns a plan; nothing is written until applying is explicitly requested |
| Did it actually do what I asked? | Reads the result from Illustrator and verifies the text, position, color, order, or other state relevant to the operation |
| What if something goes wrong halfway through? | Uses supported recovery procedures and checks restoration; failed recovery is reported explicitly |
| The response stopped. Is it safe to try again? | Retains execution records, blocks subsequent changes when the result is unknown, and does not repeat the same finalized command |

Creation, editing, native read-back, recovery, and retries have been tested per operation in real Illustrator. For the verified environments and scope, see [Per-operation live verification](compatibility.en.md#per-operation-live-verification).

## What verification does not guarantee

- `verified` describes matching values within that operation's checks, not restoration of every document or appearance attribute. Character-style restoration now checks style assignments, but forcing a failure through the actual tool and completing a live rollback remains unverified.
- These checks establish whether the intended edit occurred. Creative judgment and final print approval remain yours.
- Operation-specific recovery is not a substitute for backing up a working file.
- Replayed results are historical execution evidence. Read again with a current document key to establish present state.

## Retries and unknown results

- **The same `command_id` is never applied twice.** Resending a finalized command returns its recorded result (replay). Reusing an ID for a different request is rejected before writing.
- **A timeout is an unknown result, not a failure.** While an unresolved command remains, all further changes are blocked.
- **Reconcile before moving on.** Use `illustrator_reconcile` with `action=inspect` to check the state. Abandoning a record with `action=abandon` requires a matching `confirm_command_id`.
- **A stopped command whose outcome cannot be verified can be released explicitly, as a last resort.** Only when `action=inspect` reports `canReleaseUnverified: true`, run `action=release_unverified` with `command_id` and an identical `confirm_command_id`. Before that, check in Illustrator that no script is still running and what the document looks like (close a saved file without saving and reopen it; check an unsaved document by eye). The release does not verify the document. That command is never resent or reapplied, so read again and plan the same change from scratch. Its records are kept as evidence, never deleted or compacted.
- Unknown-result records are never deleted or compacted automatically. Do not delete the state folder by hand.

For what to do when an operation stops, see the [recovery steps](runbook.en.md#no-response-or-an-unknown-outcome).

## Saving over, exporting, and backups

- **Saving over a file** (`illustrator_save_document`) requires the `backup_id` of a verified backup from `illustrator_create_backup`. If the hashes of the backup and the file on disk do not match, the call is rejected before Illustrator is touched.
- **Backups** (`illustrator_create_backup`) copy the saved file create-exclusively, then open a restore-test copy and compare its structure. The source document and file are never modified. Backups are never deleted automatically. The effective ceiling is 1,000 objects (extrapolated from one 600-object live run).
- **Save-as and export** (`illustrator_save_document_as`, `illustrator_export_outlined`, `illustrator_optimize_images`) write only to paths that do not exist yet. Outlining happens only on the export copy.
- If a backup or export ends with an unknown result, changes stay blocked until `illustrator_reconcile_backup` / `illustrator_reconcile_export` releases the session.
- **Embedding an image** (`illustrator_embed_image`) covers only a linked JPEG/PNG directly on a layer in an RGB document. It cannot be undone in the document, so like deletion it requires a clean saved document, a verified backup's `backup_id`, and the echo of the plan's before / after. If the result is unknown after the embed ran, the Illustrator lock stays held; after releasing it with `illustrator_reconcile` `action=release_unverified`, the unchanged file equals the backup, so closing without saving and reopening returns to the state before embedding (never done automatically). Only an `embed()` that Illustrator refused while the linked item still reads back unchanged is settled as "no change".
- **Deletion** (`illustrator_delete_objects`) removes one object per call. It requires a verified backup's `backup_id` and the echo of the target-set hash and count the plan returned. There is no in-call undo: if a deletion ends with an unknown result, the Illustrator lock stays held. Abandon cannot release it: check the document in Illustrator, release the command with `illustrator_reconcile` `action=release_unverified` (with `confirm_command_id`), and then `illustrator_reconcile_delete` closes the document without saving and reopens the unchanged file.

## Operational notes

- A file-backed document must be saved with no pending changes before mutation (`mutationProfile: saved_file`); a never-saved document is mutable as `unsaved_document` because no existing file can be damaged, but it cannot be backed up. `expected_document_key` accepts the full key or the 16-hex `keyShort` from `illustrator_get_context`. Newly created point-text UUIDs may change at the next save.
- To keep editing a saved file without intermediate saves, declare occupancy with `illustrator_open_edit_session` (a verified backup is required). While the session is open only declared operations change the dirty document; external changes are refused at the next change or by the full check before saving, and the file is not written. State the fingerprint does not cover (appearance stacks, placed-image pixels, and so on) is the user's responsibility. After a timeout the session is suspended. Reconcile the unknown command and inspect document state before considering session close → save under the backup contract → open a new session. Closing a session alone does not release an unresolved command lock. Deletion (`illustrator_delete_objects`) and image embedding (`illustrator_embed_image`) are not available while a session is open: their recovery reopens the unchanged file, which would drop the session's changes.
- The server addresses `id:com.adobe.illustrator` by default. A LaunchServices name in `ILLUSTRATOR_APPLICATION` is refused as `application_ambiguous` while stable and Beta Illustrator run together; `illustrator_get_context` and `illustrator_list_documents` report `application { bundleId, version, channel }` so the answering instance is visible on every read.
- Text editing accepts only supported styles. Range replacement preserves outside styles but rejects manual pair kerning, U+200D content, and unmeasured cluster boundaries. Paragraph-style mutation is unsupported.
- Relinking replaces the native UUID; use the new UUID returned in the result. Different pixel dimensions and a missing original link are blocked.
- In CMYK documents, stacking-order changes support bring-to-front (`front`) only, and compound-path creation is refused.
- Object absence is conclusive only after the final list page. Print preflight cannot pass with required checks unavailable or truncated.

## Known stop and replay limits

- Long document keys can exceed the 4,096-byte read limit for execution records even though input accepts up to 16,384 characters. A record may be written but unreadable afterwards. Character counts differ from UTF-8 byte counts; no universally safe path-length threshold is claimed. Unreadable records are refused. Do not bypass this by using another command ID or deleting records.
- Some GroupItem references intermittently become invalid through multiple read paths. Skipping unreadable targets, automatic retry, and guaranteed recovery by restarting Illustrator are not supported responses. A later successful measurement does not replace the earlier failure evidence.

</details>
