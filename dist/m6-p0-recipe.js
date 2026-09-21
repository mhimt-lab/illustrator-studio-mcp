import { createHash } from 'node:crypto';
import { isShortDocumentKey } from './document-key.js';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';
import { canonicalCommandIdSchema } from './command-id.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { boundAppearancePreviewResultSchema, pathAppearanceMutationSchema, pathAppearanceStateSchema, } from './adapters/set-path-appearance-adapter.js';
import { IndeterminateExecutionError, ProvenPreApplyFailureError } from './domain.js';
export const M6_P0_RECIPE_ID = 'm6_appearance_preview_v2';
export const M6_P0_RECIPE_VERSION = 2;
export const M6_P0_RECIPE_DEFINITION = Object.freeze({
    id: M6_P0_RECIPE_ID,
    version: M6_P0_RECIPE_VERSION,
    steps: Object.freeze([
        Object.freeze({ id: 'set_path_appearance', operation: 'set_path_appearance', version: 9 }),
        Object.freeze({ id: 'render_png_preview', operation: 'set_path_appearance.bound_preview', version: 2 }),
        Object.freeze({ id: 'publish_png_preview', operation: 'publish_png_no_replace', version: 4 }),
    ]),
    arbitraryCodeAllowed: false,
    automaticRetryAllowed: false,
});
export const M6_P0_RECIPE_HASH = canonicalSha256(M6_P0_RECIPE_DEFINITION);
export function deriveM6P0DocumentBindingKey(documentKey) {
    return documentKey.replace(/\|saved=(?:true|false)\|/, '|saved=*|');
}
const previewRequestSchema = z.strictObject({
    destinationPath: z.string().min(1).max(16_384),
    artboardIndex: z.number().int().safe().nonnegative(),
    scalePercent: z.number().finite().min(1).max(100),
});
const previewPublicRequestSchema = z.strictObject({
    destination_path: z.string().min(1).max(16_384),
    artboard_index: z.number().int().safe().nonnegative(),
    scale_percent: z.number().finite().min(1).max(100),
});
const commonInternalRecipeFields = {
    recipeId: z.literal(M6_P0_RECIPE_ID),
    recipeVersion: z.literal(M6_P0_RECIPE_VERSION),
    expectedDocumentKey: z.string().min(1).max(16_384).refine((key) => !isShortDocumentKey(key), {
        message: 'The M6 P0 recipe binds the full document key; the short key form is not accepted here.',
    }),
    targetUuid: z.string().min(1).max(255),
    appearance: pathAppearanceMutationSchema,
    preview: previewRequestSchema,
    recipeExecutionId: canonicalCommandIdSchema,
};
export const m6P0RecipeInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternalRecipeFields, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternalRecipeFields,
        expectedBefore: pathAppearanceStateSchema,
        confirmedAfter: pathAppearanceStateSchema,
        apply: z.literal(true),
        boundEffectCommandId: canonicalCommandIdSchema,
    }),
]);
const commonPublicRecipeFields = {
    recipe_id: z.literal(M6_P0_RECIPE_ID),
    recipe_version: z.literal(M6_P0_RECIPE_VERSION),
    expected_document_key: z.string().min(1).max(16_384).refine((key) => !isShortDocumentKey(key), {
        message: 'The M6 P0 recipe binds the full document key; the short key form is not accepted here.',
    }),
    target_uuid: z.string().min(1).max(255),
    appearance: pathAppearanceMutationSchema,
    preview: previewPublicRequestSchema,
    recipe_execution_id: canonicalCommandIdSchema,
};
export const m6P0RecipePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublicRecipeFields, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublicRecipeFields,
        expected_before: pathAppearanceStateSchema,
        confirmed_after: pathAppearanceStateSchema,
        apply: z.literal(true),
        bound_effect_command_id: canonicalCommandIdSchema,
    }),
]);
export const m6P0RecipeInputSchema = z.strictObject({
    ...commonPublicRecipeFields,
    expected_before: pathAppearanceStateSchema.optional(),
    confirmed_after: pathAppearanceStateSchema.optional(),
    apply: z.boolean().default(false),
    bound_effect_command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedRecipeInput } = z.toJSONSchema(m6P0RecipePublicInputSchema, { io: 'input' });
m6P0RecipeInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedRecipeInput });
export function normalizeM6P0RecipePublicInput(input) {
    const value = m6P0RecipePublicInputSchema.parse(input);
    const common = {
        recipeId: value.recipe_id,
        recipeVersion: value.recipe_version,
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        appearance: value.appearance,
        preview: {
            destinationPath: value.preview.destination_path,
            artboardIndex: value.preview.artboard_index,
            scalePercent: value.preview.scale_percent,
        },
        recipeExecutionId: value.recipe_execution_id,
    };
    return value.apply
        ? {
            ...common,
            expectedBefore: value.expected_before,
            confirmedAfter: value.confirmed_after,
            apply: true,
            boundEffectCommandId: value.bound_effect_command_id,
        }
        : { ...common, apply: false };
}
function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}
function hasCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
async function requireMissing(path, description) {
    try {
        await lstat(path);
        throw codedError(`${description} already exists; non-overwrite publication is required.`, 'EEXIST');
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
            return;
        throw error;
    }
}
async function derivePngPreviewPublicationPlan(input) {
    if (!isAbsolute(input.destinationPath) || resolve(input.destinationPath) !== input.destinationPath ||
        extname(input.destinationPath).toLowerCase() !== '.png') {
        throw codedError('Preview destination must be a normalized absolute .png path.', 'INVALID_DESTINATION');
    }
    canonicalCommandIdSchema.parse(input.recipeExecutionId);
    const requestedDirectory = dirname(input.destinationPath);
    const destinationDirectory = await realpath(requestedDirectory);
    if (destinationDirectory !== requestedDirectory ||
        join(destinationDirectory, basename(input.destinationPath)) !== input.destinationPath) {
        throw codedError('Preview destination directory must be canonical and cannot use a symlink alias.', 'NONCANONICAL_DESTINATION');
    }
    const directoryStat = await stat(destinationDirectory, { bigint: true });
    if (!directoryStat.isDirectory())
        throw codedError('Preview destination parent is not a directory.', 'INVALID_DESTINATION');
    const stagingBasePath = join(destinationDirectory, `m6-preview-${input.recipeExecutionId}`);
    const stagingPath = `${stagingBasePath}.png`;
    return {
        destinationPath: input.destinationPath,
        destinationDirectory,
        destinationDirectoryIdentity: { dev: String(directoryStat.dev), ino: String(directoryStat.ino) },
        stagingBasePath,
        stagingPath,
        recipeExecutionId: input.recipeExecutionId,
    };
}
async function revalidatePngPreviewPublicationPlan(planValue) {
    const plan = await derivePngPreviewPublicationPlan({
        destinationPath: planValue.destinationPath,
        recipeExecutionId: planValue.recipeExecutionId,
    });
    if (plan.destinationDirectory !== planValue.destinationDirectory ||
        plan.destinationDirectoryIdentity.dev !== planValue.destinationDirectoryIdentity.dev ||
        plan.destinationDirectoryIdentity.ino !== planValue.destinationDirectoryIdentity.ino ||
        plan.stagingBasePath !== planValue.stagingBasePath ||
        plan.stagingPath !== planValue.stagingPath) {
        throw codedError('Preview publication plan or parent identity changed.', 'PUBLICATION_PLAN_MISMATCH');
    }
    return plan;
}
export async function preparePngPreviewPublication(input) {
    const plan = await derivePngPreviewPublicationPlan(input);
    await requireMissing(plan.destinationPath, 'Preview destination');
    await requireMissing(plan.stagingBasePath, 'Preview staging base');
    await requireMissing(plan.stagingPath, 'Preview staging artifact');
    return plan;
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function inspectPng(bytes) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) {
        throw codedError('Preview staging artifact is not a structurally valid PNG.', 'INVALID_PNG');
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let sawHeader = false;
    let sawData = false;
    let sawEnd = false;
    let sawPalette = false;
    let dataEnded = false;
    const compressed = [];
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length)
            throw codedError('Preview PNG has a truncated chunk header.', 'INVALID_PNG');
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > bytes.length)
            throw codedError('Preview PNG has a truncated chunk body.', 'INVALID_PNG');
        const typeBytes = bytes.subarray(offset + 4, offset + 8);
        const type = typeBytes.toString('ascii');
        if (!/^[A-Za-z]{4}$/.test(type))
            throw codedError('Preview PNG has an invalid chunk type.', 'INVALID_PNG');
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
        if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
            throw codedError(`Preview PNG ${type} chunk CRC is invalid.`, 'INVALID_PNG');
        }
        if (!sawHeader) {
            if (type !== 'IHDR' || length !== 13)
                throw codedError('Preview PNG must begin with one IHDR chunk.', 'INVALID_PNG');
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            if (width < 1 || height < 1 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
                throw codedError('Preview PNG IHDR is unsupported or invalid.', 'INVALID_PNG');
            }
            const validDepths = {
                0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
            };
            if (!(validDepths[colorType]?.includes(bitDepth) ?? false)) {
                throw codedError('Preview PNG bit depth and color type are invalid.', 'INVALID_PNG');
            }
            sawHeader = true;
        }
        else if (type === 'IHDR') {
            throw codedError('Preview PNG contains multiple IHDR chunks.', 'INVALID_PNG');
        }
        else if (type === 'PLTE') {
            if (sawData || sawPalette || length < 3 || length > 768 || length % 3 !== 0 ||
                colorType === 0 || colorType === 4 || (colorType === 3 && length / 3 > 2 ** bitDepth)) {
                throw codedError('Preview PNG palette chunk is invalid or out of order.', 'INVALID_PNG');
            }
            sawPalette = true;
        }
        else if (type === 'IDAT') {
            if (sawEnd || dataEnded || (colorType === 3 && !sawPalette)) {
                throw codedError('Preview PNG image data is invalid or out of order.', 'INVALID_PNG');
            }
            sawData = true;
            compressed.push(Buffer.from(data));
        }
        else if (type === 'IEND') {
            if (length !== 0 || !sawData)
                throw codedError('Preview PNG IEND is invalid or precedes image data.', 'INVALID_PNG');
            sawEnd = true;
            offset = end;
            break;
        }
        else {
            if (sawData)
                dataEnded = true;
            if (type[0] === type[0]?.toUpperCase()) {
                throw codedError(`Preview PNG contains unsupported critical chunk ${type}.`, 'INVALID_PNG');
            }
        }
        offset = end;
    }
    if (!sawHeader || !sawData || !sawEnd || offset !== bytes.length) {
        throw codedError('Preview PNG is incomplete or has trailing bytes.', 'INVALID_PNG');
    }
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (channels === undefined)
        throw codedError('Preview PNG color type is unsupported.', 'INVALID_PNG');
    const rowBytes = Math.ceil(width * channels * bitDepth / 8);
    const decodedLength = (rowBytes + 1) * height;
    if (!Number.isSafeInteger(decodedLength) || decodedLength < 1 || decodedLength > 512 * 1024 * 1024) {
        throw codedError('Preview PNG decoded image is outside the bounded P0 profile.', 'INVALID_PNG');
    }
    let decoded;
    try {
        decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: decodedLength });
    }
    catch (_error) {
        throw codedError('Preview PNG image data cannot be decoded.', 'INVALID_PNG');
    }
    if (decoded.length !== decodedLength)
        throw codedError('Preview PNG decoded image length is invalid.', 'INVALID_PNG');
    for (let row = 0; row < height; row++) {
        if (decoded[row * (rowBytes + 1)] > 4)
            throw codedError('Preview PNG uses an invalid scanline filter.', 'INVALID_PNG');
    }
    return { width, height };
}
function secureReadFlags() {
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
        throw codedError('Secure PNG publication requires O_NOFOLLOW and O_NONBLOCK.', 'UNSUPPORTED_FILESYSTEM');
    }
    return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}
function identity(statValue) {
    return { dev: String(statValue.dev), ino: String(statValue.ino), size: String(statValue.size) };
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}
function sameFileSnapshot(left, right) {
    return sameIdentity(left, right) && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
async function readVerifiedPngHandle(handle) {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 100n * 1024n * 1024n) {
        throw codedError('Preview artifact is not a bounded regular file.', 'INVALID_STAGING');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
        const readResult = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (readResult.bytesRead === 0)
            throw codedError('Preview artifact ended during verification.', 'STAGING_CHANGED');
        offset += readResult.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after) || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw codedError('Preview artifact changed during verification.', 'STAGING_CHANGED');
    }
    const dimensions = inspectPng(bytes);
    return {
        stat: before,
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: dimensions.width,
        height: dimensions.height,
    };
}
function assertExpectedRenderEvidence(actual, expected) {
    if (expected === undefined)
        return;
    if (canonicalSha256(actual) !== canonicalSha256(expected)) {
        throw codedError('Staging artifact no longer matches durable render evidence.', 'RENDER_EVIDENCE_MISMATCH');
    }
}
export async function publishPngPreviewNoReplace(planValue, options = {}) {
    const plan = await revalidatePngPreviewPublicationPlan(planValue);
    const stagingHandle = await open(plan.stagingPath, secureReadFlags());
    let destinationHandle;
    let linkedByThisCall = false;
    try {
        const staging = await readVerifiedPngHandle(stagingHandle);
        const renderEvidence = {
            sha256: staging.sha256,
            size: staging.bytes.length,
            width: staging.width,
            height: staging.height,
            stagingIdentity: identity(staging.stat),
        };
        assertExpectedRenderEvidence(renderEvidence, options.expectedRenderEvidence);
        await options.fault?.('before_no_replace_link');
        try {
            await link(plan.stagingPath, plan.destinationPath);
            linkedByThisCall = true;
            await options.fault?.('after_no_replace_link_before_record');
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
            if (options.expectedRenderEvidence === undefined || options.onBoundary === undefined)
                throw error;
        }
        destinationHandle = await open(plan.destinationPath, secureReadFlags());
        const published = await readVerifiedPngHandle(destinationHandle);
        if (!sameIdentity(staging.stat, published.stat) || staging.sha256 !== published.sha256 ||
            staging.width !== published.width || staging.height !== published.height) {
            throw codedError('Destination is not the verified rendered staging inode and bytes.', 'PUBLICATION_CLAIM_CONFLICT');
        }
        const evidence = {
            ...renderEvidence,
            destinationIdentity: identity(published.stat),
        };
        await options.onBoundary?.('no_replace_link', evidence);
        await options.fault?.('after_no_replace_link');
        await options.fault?.('before_file_sync');
        await destinationHandle.sync();
        await options.onBoundary?.('file_synced', evidence);
        await options.fault?.('after_file_sync');
        await options.fault?.('before_directory_sync');
        const directoryHandle = await open(plan.destinationDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
            const directoryStat = await directoryHandle.stat({ bigint: true });
            if (String(directoryStat.dev) !== plan.destinationDirectoryIdentity.dev ||
                String(directoryStat.ino) !== plan.destinationDirectoryIdentity.ino) {
                throw codedError('Preview destination directory identity changed before sync.', 'PUBLICATION_IDENTITY_MISMATCH');
            }
            await directoryHandle.sync();
        }
        finally {
            await directoryHandle.close();
        }
        await options.onBoundary?.('directory_synced', evidence);
        await options.fault?.('after_directory_sync');
        await options.fault?.('before_artifact_binding');
        const finalPublished = await readVerifiedPngHandle(destinationHandle);
        if (finalPublished.sha256 !== staging.sha256 || finalPublished.width !== staging.width ||
            finalPublished.height !== staging.height || finalPublished.bytes.length !== staging.bytes.length) {
            throw codedError('Published preview bytes changed before artifact binding.', 'PUBLICATION_IDENTITY_MISMATCH');
        }
        const [stagingPathStat, destinationPathStat, heldStagingStat, heldDestinationStat] = await Promise.all([
            lstat(plan.stagingPath, { bigint: true }),
            lstat(plan.destinationPath, { bigint: true }),
            stagingHandle.stat({ bigint: true }),
            destinationHandle.stat({ bigint: true }),
        ]);
        if (!sameIdentity(staging.stat, heldStagingStat) ||
            !sameFileSnapshot(finalPublished.stat, heldDestinationStat) ||
            !sameFileSnapshot(finalPublished.stat, stagingPathStat) ||
            !sameFileSnapshot(finalPublished.stat, destinationPathStat)) {
            throw codedError('Published preview path or inode changed before artifact binding.', 'PUBLICATION_IDENTITY_MISMATCH');
        }
        await revalidatePngPreviewPublicationPlan(plan);
        await options.onBoundary?.('artifact_binding', evidence);
        await options.fault?.('after_artifact_binding');
        return {
            destinationPath: plan.destinationPath,
            stagingPath: plan.stagingPath,
            format: 'png',
            sha256: published.sha256,
            size: published.bytes.length,
            width: published.width,
            height: published.height,
            retainedStaging: true,
            publication: 'atomic_hard_link_no_replace',
        };
    }
    catch (error) {
        if (linkedByThisCall || hasCode(error, 'PUBLICATION_CLAIM_CONFLICT') ||
            hasCode(error, 'PUBLICATION_IDENTITY_MISMATCH')) {
            throw codedError(`Preview publication outcome is indeterminate after the no-replace link: ${error instanceof Error ? error.message : String(error)}`, 'PUBLICATION_INDETERMINATE');
        }
        throw error;
    }
    finally {
        await destinationHandle?.close().catch(() => undefined);
        await stagingHandle.close().catch(() => undefined);
    }
}
const recipeAppearancePlanSchema = z.strictObject({
    targetUuid: z.string().min(1).max(255),
    before: pathAppearanceStateSchema,
    after: pathAppearanceStateSchema,
    confirmationStatus: z.literal('required'),
    applyAllowed: z.literal(false),
});
function evidenceDigest(value) {
    return canonicalSha256(JSON.parse(JSON.stringify(value)));
}
function canonicalValue(value) {
    return JSON.parse(JSON.stringify(value));
}
function failureResult(error, failedStep, audit, publicationPlan, input, executionDigest, authorityState, appearanceEvidence, preApplyFailure = false, preApplyCommandId = null) {
    const indeterminate = !preApplyFailure || error instanceof IndeterminateExecutionError ||
        hasCode(error, 'PUBLICATION_INDETERMINATE');
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const reasonCode = typeof error === 'object' && error !== null && 'code' in error &&
        typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : error instanceof IndeterminateExecutionError ? 'APPEARANCE_EXECUTION_INDETERMINATE' : 'UNEXPECTED_ERROR';
    const commandId = preApplyFailure
        ? preApplyCommandId
        : input.apply ? input.boundEffectCommandId : null;
    audit.push({
        sequence: audit.length,
        stepId: failedStep,
        status: indeterminate ? 'indeterminate' : 'failed',
        evidenceDigest: evidenceDigest({ message, commandId }),
    });
    return {
        recipeId: M6_P0_RECIPE_ID,
        recipeVersion: M6_P0_RECIPE_VERSION,
        recipeHash: M6_P0_RECIPE_HASH,
        recipeExecutionId: input.recipeExecutionId,
        executionDigest,
        protocolState: indeterminate ? 'quarantined_indeterminate' : 'closed_failed_pre_apply',
        authorityState,
        status: indeterminate ? 'indeterminate' : 'failed',
        failedStep,
        message,
        reasonCode,
        commandId,
        stepAudit: audit,
        publicationEvidence: {
            destinationPath: publicationPlan.destinationPath,
            stagingPath: publicationPlan.stagingPath,
            state: preApplyFailure
                ? 'not_created'
                : failedStep === 'render_png_preview'
                    ? 'retained_or_unknown'
                    : indeterminate ? 'published_or_unknown' : 'retained_or_unknown',
        },
        appearanceEvidence,
    };
}
function extractOutcome(response) {
    if (typeof response !== 'object' || response === null || !('outcome' in response) ||
        typeof response.outcome !== 'object' || response.outcome === null) {
        throw new Error('Appearance adapter response is missing its outcome.');
    }
    return response.outcome;
}
function buildExecutionBinding(input, publicationPlan) {
    return {
        protocolVersion: 2,
        documentBindingVersion: 1,
        effectBindingVersion: 2,
        publicationBindingVersion: 2,
        recipeId: M6_P0_RECIPE_ID,
        recipeVersion: M6_P0_RECIPE_VERSION,
        recipeHash: M6_P0_RECIPE_HASH,
        documentKey: input.expectedDocumentKey,
        documentBindingKey: deriveM6P0DocumentBindingKey(input.expectedDocumentKey),
        targetUuid: input.targetUuid,
        boundEffectCommandId: input.boundEffectCommandId,
        expectedAppearance: input.expectedBefore,
        confirmedAppearance: input.confirmedAfter,
        requestedAppearance: input.appearance,
        artboard: { index: input.preview.artboardIndex, scalePercent: input.preview.scalePercent },
        canonicalDestination: publicationPlan.destinationPath,
        destinationDirectory: publicationPlan.destinationDirectory,
        destinationDirectoryIdentity: publicationPlan.destinationDirectoryIdentity,
    };
}
const activeRecipeExecutions = new Map();
export async function executeM6P0AppearancePreviewRecipe(inputValue, dependencies) {
    const input = m6P0RecipeInternalInputSchema.parse(inputValue);
    if (!input.apply)
        return await executeM6P0AppearancePreviewRecipeOwned(input, dependencies);
    const publicationPlan = await derivePngPreviewPublicationPlan({
        destinationPath: input.preview.destinationPath,
        recipeExecutionId: input.recipeExecutionId,
    });
    const executionDigest = canonicalSha256(buildExecutionBinding(input, publicationPlan));
    const flightKey = `${dependencies.authorityStore.root}\0${input.recipeExecutionId}`;
    const active = activeRecipeExecutions.get(flightKey);
    if (active !== undefined) {
        if (active.executionDigest !== executionDigest) {
            throw codedError('Recipe execution ID is already active with another canonical digest.', 'RECIPE_EXECUTION_CONFLICT');
        }
        return await active.promise;
    }
    const promise = executeM6P0AppearancePreviewRecipeOwned(input, dependencies);
    activeRecipeExecutions.set(flightKey, { executionDigest, promise });
    try {
        return await promise;
    }
    finally {
        if (activeRecipeExecutions.get(flightKey)?.promise === promise)
            activeRecipeExecutions.delete(flightKey);
    }
}
async function executeM6P0AppearancePreviewRecipeOwned(inputValue, dependencies) {
    const input = m6P0RecipeInternalInputSchema.parse(inputValue);
    const publicationPlan = await derivePngPreviewPublicationPlan({
        destinationPath: input.preview.destinationPath,
        recipeExecutionId: input.recipeExecutionId,
    });
    const executionBinding = input.apply
        ? buildExecutionBinding(input, publicationPlan)
        : {
            protocolVersion: 2,
            effectBindingVersion: 2,
            publicationBindingVersion: 2,
            recipeId: M6_P0_RECIPE_ID,
            recipeVersion: M6_P0_RECIPE_VERSION,
            recipeHash: M6_P0_RECIPE_HASH,
            documentKey: input.expectedDocumentKey,
            targetUuid: input.targetUuid,
            boundEffectCommandId: null,
            expectedAppearance: null,
            confirmedAppearance: null,
            requestedAppearance: input.appearance,
            artboard: { index: input.preview.artboardIndex, scalePercent: input.preview.scalePercent },
            canonicalDestination: publicationPlan.destinationPath,
            destinationDirectory: publicationPlan.destinationDirectory,
            destinationDirectoryIdentity: publicationPlan.destinationDirectoryIdentity,
        };
    const executionDigest = canonicalSha256(executionBinding);
    const stepAudit = [];
    if (!input.apply) {
        await requireMissing(publicationPlan.destinationPath, 'Preview destination');
        await requireMissing(publicationPlan.stagingBasePath, 'Preview staging base');
        await requireMissing(publicationPlan.stagingPath, 'Preview staging artifact');
        const appearancePlanResponse = await dependencies.executeAppearance({
            expectedDocumentKey: input.expectedDocumentKey,
            targetUuid: input.targetUuid,
            appearance: input.appearance,
            apply: false,
        });
        const outcome = extractOutcome(appearancePlanResponse);
        const transaction = outcome.transaction;
        if (transaction?.state !== 'planned')
            throw new Error('Appearance adapter did not return a planning-only outcome.');
        const appearancePlan = recipeAppearancePlanSchema.parse(outcome.plan);
        if (appearancePlan.targetUuid !== input.targetUuid)
            throw new Error('Appearance plan UUID does not match the recipe target.');
        stepAudit.push({ sequence: 0, stepId: 'set_path_appearance', status: 'planned', evidenceDigest: evidenceDigest(outcome) });
        stepAudit.push({ sequence: 1, stepId: 'render_png_preview', status: 'planned', evidenceDigest: evidenceDigest(publicationPlan) });
        return {
            recipeId: M6_P0_RECIPE_ID,
            recipeVersion: M6_P0_RECIPE_VERSION,
            recipeHash: M6_P0_RECIPE_HASH,
            recipeExecutionId: input.recipeExecutionId,
            executionDigest,
            protocolState: 'open',
            status: 'planned',
            stepAudit,
            appearancePlan,
            publicationPlan,
        };
    }
    const authority = dependencies.authorityStore;
    const began = await authority.begin({
        recipeExecutionId: input.recipeExecutionId,
        executionDigest,
        binding: canonicalValue(executionBinding),
    });
    let records = began.inspection.records;
    const terminal = records.find((record) => record.state === 'closed_completed' || record.state === 'closed_failed_pre_apply');
    if (terminal) {
        const evidence = terminal.evidence;
        return m6P0RecipeResultSchema.parse(evidence.result);
    }
    const lastState = () => records.at(-1).state;
    const refresh = async () => {
        const inspection = await authority.inspect(input.recipeExecutionId);
        if (inspection.state !== 'valid' || inspection.records[0]?.executionDigest !== executionDigest) {
            throw codedError('Recipe authority became invalid during execution.', 'RECIPE_AUTHORITY_INDETERMINATE');
        }
        records = inspection.records;
    };
    const waitForAdvance = async () => {
        const sequence = records.at(-1).sequence;
        await authority.waitForAdvance(input.recipeExecutionId, executionDigest, sequence);
        await refresh();
    };
    const recordFor = (state) => records.find((record) => record.state === state);
    const readBoundEffectEvidence = (record) => {
        const evidence = record?.evidence;
        if (evidence === undefined)
            return null;
        const appearanceEvidence = evidence.appearanceEvidence;
        const preview = boundAppearancePreviewResultSchema.safeParse(evidence.boundPreview);
        const renderEvidence = evidence.renderEvidence;
        if (appearanceEvidence?.postcondition?.targetUuid !== input.targetUuid ||
            !/^[a-f0-9]{64}$/.test(appearanceEvidence.evidenceDigest) ||
            canonicalSha256(appearanceEvidence.postcondition.appearance) !==
                canonicalSha256(input.confirmedAfter) ||
            !preview.success || preview.data.binding.targetUuid !== input.targetUuid ||
            canonicalSha256(preview.data.appearanceBefore) !==
                canonicalSha256(appearanceEvidence.postcondition) ||
            canonicalSha256(preview.data.appearanceAfter) !==
                canonicalSha256(appearanceEvidence.postcondition) ||
            preview.data.stagingPath !== publicationPlan.stagingPath ||
            preview.data.artboardIndex !== input.preview.artboardIndex ||
            preview.data.scalePercent !== input.preview.scalePercent ||
            deriveM6P0DocumentBindingKey(preview.data.documentBefore.key) !==
                deriveM6P0DocumentBindingKey(input.expectedDocumentKey) ||
            renderEvidence === undefined || !/^[a-f0-9]{64}$/.test(renderEvidence.sha256) ||
            !Number.isSafeInteger(renderEvidence.size) || renderEvidence.size < 1 ||
            !Number.isSafeInteger(renderEvidence.width) || renderEvidence.width < 1 ||
            !Number.isSafeInteger(renderEvidence.height) || renderEvidence.height < 1 ||
            typeof renderEvidence.stagingIdentity?.dev !== 'string' ||
            typeof renderEvidence.stagingIdentity?.ino !== 'string' ||
            !/^[a-f0-9]{64}$/.test(String(evidence.evidenceDigest ?? '')) ||
            evidence.evidenceDigest !== evidenceDigest({
                appearanceEvidence,
                boundPreview: preview.data,
                renderEvidence,
            }))
            return null;
        return {
            appearanceEvidence,
            boundPreview: preview.data,
            renderEvidence,
            evidenceDigest: evidence.evidenceDigest,
        };
    };
    if (lastState() === 'open') {
        try {
            await requireMissing(publicationPlan.destinationPath, 'Preview destination');
            await requireMissing(publicationPlan.stagingBasePath, 'Preview staging base');
            await requireMissing(publicationPlan.stagingPath, 'Preview staging artifact');
        }
        catch (error) {
            const result = failureResult(error, 'set_path_appearance', stepAudit, publicationPlan, input, executionDigest, 'closed_failed_pre_apply', null, true);
            await authority.append(input.recipeExecutionId, executionDigest, 'closed_failed_pre_apply', canonicalValue({ result }));
            return result;
        }
        await authority.append(input.recipeExecutionId, executionDigest, 'writing_bound_effect', canonicalValue({
            boundEffectCommandId: input.boundEffectCommandId,
            documentBindingKey: deriveM6P0DocumentBindingKey(input.expectedDocumentKey),
            targetUuid: input.targetUuid,
            stagingPath: publicationPlan.stagingPath,
            destinationDirectoryIdentity: publicationPlan.destinationDirectoryIdentity,
        }));
        await refresh();
    }
    let boundEffectEvidence = readBoundEffectEvidence(recordFor('bound_effect_verified'));
    if (boundEffectEvidence === null && lastState() === 'writing_bound_effect') {
        let candidateAppearanceEvidence = null;
        let failure = null;
        try {
            await revalidatePngPreviewPublicationPlan(publicationPlan);
            const response = await dependencies.executeAppearance({
                expectedDocumentKey: input.expectedDocumentKey,
                targetUuid: input.targetUuid,
                appearance: input.appearance,
                expectedBefore: input.expectedBefore,
                confirmedAfter: input.confirmedAfter,
                apply: true,
                commandId: input.boundEffectCommandId,
                boundPreview: {
                    expectedDocumentBindingKey: deriveM6P0DocumentBindingKey(input.expectedDocumentKey),
                    artboardIndex: input.preview.artboardIndex,
                    scalePercent: input.preview.scalePercent,
                    stagingBasePath: publicationPlan.stagingBasePath,
                    stagingPath: publicationPlan.stagingPath,
                },
            });
            const outcome = extractOutcome(response);
            const transaction = outcome.transaction;
            if (transaction?.state !== 'verified') {
                const state = typeof transaction?.state === 'string' ? transaction.state : 'unknown';
                const reasonCode = state === 'rolled_back'
                    ? 'BOUND_EFFECT_ROLLED_BACK'
                    : state === 'apply_failed'
                        ? 'BOUND_EFFECT_APPLY_FAILED'
                        : state === 'apply_indeterminate' || state === 'rollback_indeterminate' || state === 'rollback_failed'
                            ? 'BOUND_EFFECT_INDETERMINATE'
                            : 'BOUND_EFFECT_MISMATCH';
                const message = typeof transaction?.failure?.message === 'string'
                    ? transaction.failure.message
                    : `Bound appearance-preview command ended in ${state} state.`;
                throw codedError(message, reasonCode);
            }
            const postcondition = outcome.postcondition;
            const boundPreview = boundAppearancePreviewResultSchema.parse(outcome.boundPreview);
            const expectedBoundAppearance = {
                targetUuid: input.targetUuid,
                appearance: input.confirmedAfter,
            };
            const expectedBoundAppearanceDigest = canonicalSha256(expectedBoundAppearance);
            if (postcondition?.targetUuid !== input.targetUuid ||
                canonicalSha256(postcondition.appearance) !==
                    canonicalSha256(input.confirmedAfter) ||
                boundPreview.binding.targetUuid !== input.targetUuid ||
                canonicalSha256(boundPreview.appearanceBefore) !==
                    expectedBoundAppearanceDigest ||
                canonicalSha256(boundPreview.appearanceAfter) !==
                    expectedBoundAppearanceDigest ||
                boundPreview.stagingPath !== publicationPlan.stagingPath ||
                boundPreview.artboardIndex !== input.preview.artboardIndex ||
                boundPreview.scalePercent !== input.preview.scalePercent ||
                deriveM6P0DocumentBindingKey(boundPreview.documentBefore.key) !==
                    deriveM6P0DocumentBindingKey(input.expectedDocumentKey)) {
                throw codedError('Bound appearance-preview command did not establish the exact requested effect.', 'BOUND_EFFECT_MISMATCH');
            }
            candidateAppearanceEvidence = {
                postcondition: postcondition,
                evidenceDigest: evidenceDigest(response),
            };
            const stagingHandle = await open(publicationPlan.stagingPath, secureReadFlags());
            let inspected;
            try {
                inspected = await readVerifiedPngHandle(stagingHandle);
            }
            finally {
                await stagingHandle.close();
            }
            if (boundPreview.size !== inspected.bytes.length) {
                throw codedError('Bound preview size does not match the verified staging artifact.', 'RENDER_EVIDENCE_MISMATCH');
            }
            const renderEvidence = {
                sha256: inspected.sha256,
                size: inspected.bytes.length,
                width: inspected.width,
                height: inspected.height,
                stagingIdentity: identity(inspected.stat),
            };
            const combinedEvidenceDigest = evidenceDigest({
                appearanceEvidence: candidateAppearanceEvidence,
                boundPreview,
                renderEvidence,
            });
            await authority.append(input.recipeExecutionId, executionDigest, 'bound_effect_verified', canonicalValue({
                appearanceEvidence: candidateAppearanceEvidence,
                boundPreview,
                renderEvidence,
                evidenceDigest: combinedEvidenceDigest,
                response,
            }));
            await refresh();
            boundEffectEvidence = readBoundEffectEvidence(recordFor('bound_effect_verified'));
        }
        catch (error) {
            failure = error;
            if (error instanceof ProvenPreApplyFailureError && error.commandId === input.boundEffectCommandId) {
                const terminal = failureResult(error, 'set_path_appearance', [...stepAudit], publicationPlan, input, executionDigest, 'closed_failed_pre_apply', null, true, input.boundEffectCommandId);
                try {
                    await authority.append(input.recipeExecutionId, executionDigest, 'closed_failed_pre_apply', canonicalValue({ result: terminal }));
                    return terminal;
                }
                catch (appendError) {
                    await refresh().catch(() => undefined);
                    const concurrentTerminal = recordFor('closed_failed_pre_apply');
                    if (concurrentTerminal !== undefined) {
                        const evidence = concurrentTerminal.evidence;
                        return m6P0RecipeResultSchema.parse(evidence.result);
                    }
                    return failureResult(appendError, 'set_path_appearance', stepAudit, publicationPlan, input, executionDigest, lastState(), null);
                }
            }
            const concurrentReconciliation = error instanceof IndeterminateExecutionError ||
                hasCode(error, 'RECIPE_AUTHORITY_CONFLICT');
            if (error instanceof IndeterminateExecutionError) {
                try {
                    await waitForAdvance();
                }
                catch (waitError) {
                    failure = waitError;
                }
            }
            else {
                await refresh().catch(() => undefined);
            }
            boundEffectEvidence = readBoundEffectEvidence(recordFor('bound_effect_verified'));
            if (!concurrentReconciliation || boundEffectEvidence === null) {
                return failureResult(failure, 'set_path_appearance', stepAudit, publicationPlan, input, executionDigest, lastState(), candidateAppearanceEvidence);
            }
        }
    }
    if (boundEffectEvidence === null) {
        return failureResult(codedError('Bound appearance-preview outcome requires reconciliation.', 'BOUND_EFFECT_RECONCILIATION_REQUIRED'), 'set_path_appearance', stepAudit, publicationPlan, input, executionDigest, lastState(), null);
    }
    const appearanceEvidence = boundEffectEvidence.appearanceEvidence;
    stepAudit.push({
        sequence: 0,
        stepId: 'set_path_appearance',
        status: 'verified',
        evidenceDigest: appearanceEvidence.evidenceDigest,
    });
    stepAudit.push({
        sequence: 1,
        stepId: 'render_png_preview',
        status: 'verified',
        evidenceDigest: boundEffectEvidence.evidenceDigest,
    });
    const durableRenderEvidence = boundEffectEvidence.renderEvidence;
    if (lastState() === 'bound_effect_verified') {
        try {
            await authority.append(input.recipeExecutionId, executionDigest, 'writing_publication', canonicalValue({
                renderEvidenceDigest: boundEffectEvidence.evidenceDigest,
                destinationPath: publicationPlan.destinationPath,
            }));
            await refresh();
        }
        catch (error) {
            await refresh().catch(() => undefined);
            return failureResult(error, 'publish_png_preview', stepAudit, publicationPlan, input, executionDigest, lastState(), appearanceEvidence);
        }
    }
    let artifact;
    const boundRecord = recordFor('bound');
    if (boundRecord) {
        artifact = boundRecord.evidence.artifact;
    }
    else {
        try {
            artifact = await (dependencies.publishPreview ?? publishPngPreviewNoReplace)(publicationPlan, {
                expectedRenderEvidence: durableRenderEvidence,
                ...(dependencies.publicationFault === undefined ? {} : { fault: dependencies.publicationFault }),
                onBoundary: async (boundary, publicationEvidence) => {
                    const stateByBoundary = {
                        no_replace_link: 'published_linked',
                        file_synced: 'published_file_synced',
                        directory_synced: 'published_directory_synced',
                        artifact_binding: 'bound',
                    };
                    const state = stateByBoundary[boundary];
                    const boundaryArtifact = {
                        destinationPath: publicationPlan.destinationPath,
                        stagingPath: publicationPlan.stagingPath,
                        format: 'png',
                        sha256: publicationEvidence.sha256,
                        size: publicationEvidence.size,
                        width: publicationEvidence.width,
                        height: publicationEvidence.height,
                        retainedStaging: true,
                        publication: 'atomic_hard_link_no_replace',
                    };
                    await authority.append(input.recipeExecutionId, executionDigest, state, canonicalValue({
                        publicationEvidence,
                        artifact: boundaryArtifact,
                    }));
                    await refresh();
                },
            });
        }
        catch (error) {
            return failureResult(error, 'publish_png_preview', stepAudit, publicationPlan, input, executionDigest, lastState(), appearanceEvidence);
        }
    }
    const publicationDigest = evidenceDigest(artifact);
    stepAudit.push({ sequence: 2, stepId: 'publish_png_preview', status: 'verified', evidenceDigest: publicationDigest });
    const completed = {
        recipeId: M6_P0_RECIPE_ID,
        recipeVersion: M6_P0_RECIPE_VERSION,
        recipeHash: M6_P0_RECIPE_HASH,
        recipeExecutionId: input.recipeExecutionId,
        executionDigest,
        protocolState: 'closed_completed',
        status: 'completed',
        stepAudit,
        appearancePostcondition: appearanceEvidence.postcondition,
        appearanceEvidence,
        previewArtifact: artifact,
    };
    try {
        await authority.append(input.recipeExecutionId, executionDigest, 'closed_completed', canonicalValue({ result: completed }));
    }
    catch (error) {
        return failureResult(error, 'publish_png_preview', stepAudit.slice(0, 2), publicationPlan, input, executionDigest, lastState(), appearanceEvidence);
    }
    return completed;
}
const stepAuditSchema = z.strictObject({
    sequence: z.number().int().nonnegative(),
    stepId: z.enum(['set_path_appearance', 'render_png_preview', 'publish_png_preview']),
    status: z.enum(['planned', 'verified', 'failed', 'indeterminate']),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
const publishedArtifactSchema = z.strictObject({
    destinationPath: z.string().min(1),
    stagingPath: z.string().min(1),
    format: z.literal('png'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    retainedStaging: z.literal(true),
    publication: z.literal('atomic_hard_link_no_replace'),
});
const recipeResultCommon = {
    recipeId: z.literal(M6_P0_RECIPE_ID),
    recipeVersion: z.literal(M6_P0_RECIPE_VERSION),
    recipeHash: z.literal(M6_P0_RECIPE_HASH),
    recipeExecutionId: canonicalCommandIdSchema,
    executionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    stepAudit: z.array(stepAuditSchema).min(1).max(3),
};
export const m6P0RecipeResultSchema = z.discriminatedUnion('status', [
    z.strictObject({
        ...recipeResultCommon,
        status: z.literal('planned'),
        protocolState: z.literal('open'),
        appearancePlan: recipeAppearancePlanSchema,
        publicationPlan: z.strictObject({
            destinationPath: z.string().min(1), destinationDirectory: z.string().min(1),
            destinationDirectoryIdentity: z.strictObject({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/) }),
            stagingBasePath: z.string().min(1), stagingPath: z.string().min(1), recipeExecutionId: canonicalCommandIdSchema,
        }),
    }),
    z.strictObject({
        ...recipeResultCommon,
        status: z.literal('completed'),
        protocolState: z.literal('closed_completed'),
        appearancePostcondition: z.strictObject({ targetUuid: z.string().min(1), appearance: pathAppearanceStateSchema }),
        appearanceEvidence: z.strictObject({
            postcondition: z.strictObject({ targetUuid: z.string().min(1), appearance: pathAppearanceStateSchema }),
            evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        }),
        previewArtifact: publishedArtifactSchema,
    }),
    z.strictObject({
        ...recipeResultCommon,
        status: z.literal('failed'),
        protocolState: z.literal('closed_failed_pre_apply'),
        authorityState: z.literal('closed_failed_pre_apply'),
        failedStep: z.enum(['set_path_appearance', 'render_png_preview', 'publish_png_preview']),
        message: z.string().min(1).max(500),
        reasonCode: z.string().regex(/^[A-Z0-9_]{1,64}$/),
        commandId: canonicalCommandIdSchema.nullable(),
        publicationEvidence: z.strictObject({
            destinationPath: z.string().min(1), stagingPath: z.string().min(1),
            state: z.enum(['not_created', 'retained_or_unknown', 'published_or_unknown']),
        }),
        appearanceEvidence: z.null(),
    }),
    z.strictObject({
        ...recipeResultCommon,
        status: z.literal('indeterminate'),
        protocolState: z.literal('quarantined_indeterminate'),
        authorityState: z.enum([
            'open', 'writing_bound_effect', 'bound_effect_verified',
            'writing_publication', 'published_linked', 'published_file_synced',
            'published_directory_synced', 'bound', 'closed_completed', 'closed_failed_pre_apply',
        ]),
        failedStep: z.enum(['set_path_appearance', 'render_png_preview', 'publish_png_preview']),
        message: z.string().min(1).max(500),
        reasonCode: z.string().regex(/^[A-Z0-9_]{1,64}$/),
        commandId: canonicalCommandIdSchema.nullable(),
        publicationEvidence: z.strictObject({
            destinationPath: z.string().min(1), stagingPath: z.string().min(1),
            state: z.enum(['not_created', 'retained_or_unknown', 'published_or_unknown']),
        }),
        appearanceEvidence: z.strictObject({
            postcondition: z.strictObject({ targetUuid: z.string().min(1), appearance: pathAppearanceStateSchema }),
            evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        }).nullable(),
    }),
]).superRefine((result, context) => {
    const expectedIds = ['set_path_appearance', 'render_png_preview', 'publish_png_preview'];
    for (let index = 0; index < result.stepAudit.length; index++) {
        const step = result.stepAudit[index];
        if (step.sequence !== index || step.stepId !== expectedIds[index] || step.evidenceDigest === null) {
            context.addIssue({ code: 'custom', message: 'Recipe step audit must be contiguous, allowlisted, ordered, and evidence-bound.', path: ['stepAudit', index] });
        }
    }
    if (result.status === 'planned') {
        if (result.stepAudit.length !== 2 || result.stepAudit.some((step) => step.status !== 'planned')) {
            context.addIssue({ code: 'custom', message: 'Planned recipe must contain exactly the two non-publication plan steps.', path: ['stepAudit'] });
        }
    }
    else if (result.status === 'completed') {
        if (result.stepAudit.length !== 3 || result.stepAudit.some((step) => step.status !== 'verified')) {
            context.addIssue({ code: 'custom', message: 'Completed recipe requires all three allowlisted steps to be verified.', path: ['stepAudit'] });
        }
    }
    else {
        const failure = result.stepAudit.at(-1);
        const expectedStatus = result.status === 'indeterminate' ? 'indeterminate' : 'failed';
        if (failure?.stepId !== result.failedStep || failure.status !== expectedStatus ||
            result.stepAudit.slice(0, -1).some((step) => step.status !== 'verified')) {
            context.addIssue({ code: 'custom', message: 'Failed recipe audit must stop exactly at the typed failed step.', path: ['stepAudit'] });
        }
    }
});
export const m6P0RecipeToolContract = {
    name: 'illustrator_run_m6_appearance_preview_recipe',
    title: 'Run M6 Appearance Preview Recipe',
    description: 'Run the fixed versioned M6 P0 recipe: one document-bound PathItem appearance and PNG export effect, then atomic non-overwrite publication. Arbitrary steps and code are rejected.',
    inputSchema: m6P0RecipeInputSchema,
    publicInputSchema: m6P0RecipePublicInputSchema,
    outputSchema: m6P0RecipeResultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    normalizePublicInput: normalizeM6P0RecipePublicInput,
};
