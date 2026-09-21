# Failure runbook

[日本語](runbook.md) | **English**

For the change flow, retries, and backup conditions in detail, see [Safety](safety.en.md).

## Stopped before making a change

If an operation is refused because the target changed, is locked, or has unsupported formatting, do not force the change. Read the current target again and review a new plan. Do not reuse the old plan unchanged.

## No response or an unknown outcome

1. Stop new edits, resending the same change, and automatic retries.
2. Preserve execution records and the test document. Do not bypass the stop by deleting records or locks.
3. Ask the AI: “Explain the operation's state without making any new changes.”
4. Check whether execution is still in progress and whether the result can be reconciled. Reconcile may change records or locks; it is not simply a read. Check the execution ID and intended operation before proceeding.
5. If sufficient evidence is unavailable, remain stopped and consult the maintainer. A restart does not prove success or recovery.

Resending the same execution ID may return an earlier record; it does not guarantee that the current document still has that state. There is a known limitation where records with long document-identifying information cannot be read back.

## Saving or restoration problems

A backup verifies a match only within the scope inspected by that operation. It does not guarantee every effect, external link, or print quality. Do not assume restoration succeeded; preserve the original artwork and backup when seeking help.

## Get help

Contact [Support](../SUPPORT.md) with the version, candidate checksum, AI app and Illustrator versions, operation, what you verified, and what remains unknown. Do not post artwork, customer information, document paths, raw execution records, or credentials. Send vulnerabilities through the private [Security](../SECURITY.md) contact.

Live measurement of failure paths through each AI app remains incomplete. The existence of this runbook is not evidence of successful recovery.
