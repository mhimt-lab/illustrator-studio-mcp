export const DIRTY_FILE_BLOCKED_REASON = 'Save pending document changes before mutation. '
    + 'A saved file with unsaved changes is changed only inside an edit session, and a session opens only on a clean saved file. '
    + 'To go on without overwriting the original file, save a working copy with illustrator_save_document_as (the original stays byte-identical) '
    + 'and continue on the copy: illustrator_create_backup, then illustrator_open_edit_session for several unsaved changes. '
    + 'Otherwise the user saves or reverts the document. Next time, open the session before the first change. '
    + 'A few operations continue on a saved file with unsaved changes without a session (illustrator_get_context reports mutationProfile dirty_file); '
    + 'if a save or a working copy is refused because an earlier command ended unverified, check the document first and save or reopen it yourself.';
export const UNSAVED_NEXT_STEPS_NOTE = 'If the document has unsaved changes (mutationBlockedReason "Save pending document changes"): '
    + 'save a working copy with illustrator_save_document_as (the original file stays unchanged), then on the copy run illustrator_create_backup '
    + '(and illustrator_open_edit_session for several unsaved changes) and plan the change again; or ask the user to save or revert the document. '
    + '未保存の変更がある書類なら、illustrator_save_document_as で作業コピーに保存し（原本は変わりません）、そのコピーで illustrator_create_backup（未保存のまま続けて変える時は '
    + 'illustrator_open_edit_session も）を行ってから変更を計画し直すか、利用者に保存か破棄を依頼してください。';
export const NOT_SAVED_FILE_SESSION_HINT = 'A session opens only on a clean saved file. If the document has unsaved changes that must not overwrite '
    + 'the original, save a working copy with illustrator_save_document_as and open the session on the copy (after illustrator_create_backup of it); '
    + 'otherwise the user saves or reverts the document first.';
export const USER_SAVED_SESSION_HINT = 'If the user saved the document, close this session with illustrator_close_edit_session; '
    + 'the saved file then works as an ordinary saved document (read its key again).';
export const DIRTY_FILE_BARRIER_REASON = 'Save pending document changes before mutation. '
    + 'An earlier command on this file ended with an unverified result (released without verification, or a failed rollback), so the unsaved changes in the open document are not trusted. '
    + 'Check the document in Illustrator, then save it yourself or close it without saving and reopen it, and read it again with illustrator_get_context.';
export const DIRTY_FILE_GLOBAL_BARRIER_REASON = 'Save pending document changes before mutation. '
    + 'An earlier command ended with an unverified result and the document it changed could not be identified, so no unsaved saved file is changed until every open saved file is clean. '
    + 'Check the open documents in Illustrator, save them yourself or close them without saving and reopen them, then read illustrator_list_documents.';
export const DIRTY_FILE_SESSION_REASON = 'Save pending document changes before mutation. '
    + 'An edit session for this file is still recorded (open with a changed file, or suspended). Close it with illustrator_close_edit_session first '
    + '(illustrator_get_edit_session lists it); the unsaved file then continues without a session.';
export const DIRTY_FILE_STORE_INVALID_REASON = 'Save pending document changes before mutation. '
    + 'The release-barrier state under the MCP state directory is unreadable (barrier_store_invalid), so no saved file with unsaved changes is changed. '
    + 'Ask the user to run the doctor command and repair it by hand; saving or reverting the document in Illustrator does not clear it.';
export const SAVE_REFUSED_BARRIER_MESSAGE = 'The document has unsaved changes and an earlier command on it ended unverified (released without verification, or a failed rollback), '
    + 'so the server does not write or copy its state. Check the document in Illustrator, then save it yourself or close it without saving and reopen it, and read it again with illustrator_list_documents.';
