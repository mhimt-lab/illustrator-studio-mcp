import { canonicalSha256 } from '../mutation-canonical.js';
import { assembleRelinkImageAdapter, buildRelinkImageContract, relinkImageAdapterIdentity, relinkImageScript, } from '../adapters/relink-image-adapter.js';
import { WINDOWS_RELINK_IMAGE_PLATFORM } from './image-adapter-platform.js';
import { checkLinkTargetsBeforeOpen } from './image-reparse-gate.js';
import { inspectWindowsLocalImage, windowsImageFormatOf } from './image-source-admission.js';
import { admitWindowsImageSource, blockedAdmissionOf, refusalOf, WINDOWS_PLACE_IMAGE_CONTRACT, } from './place-image.js';
export const WINDOWS_RELINK_IMAGE_CONTRACT = buildRelinkImageContract(WINDOWS_RELINK_IMAGE_PLATFORM, WINDOWS_PLACE_IMAGE_CONTRACT.admissionSchema);
export const WINDOWS_RELINK_IMAGE_SCRIPT = relinkImageScript(WINDOWS_RELINK_IMAGE_PLATFORM);
export const WINDOWS_RELINK_IMAGE_ADAPTER_IDENTITY = relinkImageAdapterIdentity(canonicalSha256(WINDOWS_RELINK_IMAGE_SCRIPT));
export const WINDOWS_RELINK_IMAGE_TOOL_DESCRIPTION = 'Plan or relink one existing linked PlacedItem (bound by document key and native UUID) to another TIFF, JPEG or PNG file given by a local drive-letter path such as C:\\images\\logo.png and its SHA-256, whose pixel dimensions equal the current link. On Windows the new file and, for an apply, the current link are checked in Node before any Illustrator call and a violation is refused with a reason code: the path must be a plain local drive-letter path (no UNC, device, relative or alternate-stream path, at most 259 characters), no symbolic link, junction or reparse point may be traversed, a cloud placeholder (OneDrive Files On-Demand) is never opened, and the file must exist, be a regular file and have a TIFF, JPEG or PNG header (PSD is not available on Windows). The frame, layer, sibling position, and name are kept; Illustrator replaces the native UUID, which the result reports. Apply requires the echoed expected_before and confirmed_after snapshots, verifies the read-back, and recovers by reassigning the original link. Missing current links and different pixel dimensions are blocked.';
export async function admitWindowsCurrentLinkOrThrow(path, inspector, check = checkLinkTargetsBeforeOpen) {
    const { resolvedPath, inspection } = await inspectWindowsLocalImage(path, 'current_link', inspector, check);
    const format = windowsImageFormatOf(inspection, 'current_link');
    const pixels = inspection.metadata.pixels;
    return {
        status: 'admitted', resolvedPath, bytes: inspection.file.bytes, modifiedAtMs: Date.parse(inspection.file.modifiedAt), sha256: inspection.file.sha256, format,
        pixels: pixels.status === 'available' ? { width: pixels.value.width, height: pixels.value.height } : null,
    };
}
export async function admitWindowsCurrentLink(path, inspector, check = checkLinkTargetsBeforeOpen) {
    try {
        return await admitWindowsCurrentLinkOrThrow(path, inspector, check);
    }
    catch (error) {
        const blocked = blockedAdmissionOf(error);
        return { status: 'blocked', resolvedPath: null, reason: blocked.reason, message: blocked.message };
    }
}
export function createWindowsRelinkImageAdapter(options = {}) {
    const check = options.checkLinkTargets ?? checkLinkTargetsBeforeOpen;
    return assembleRelinkImageAdapter({
        contract: WINDOWS_RELINK_IMAGE_CONTRACT,
        commands: { read: { kind: 'read', script: WINDOWS_RELINK_IMAGE_SCRIPT }, mutation: { kind: 'mutation', script: WINDOWS_RELINK_IMAGE_SCRIPT } },
        toolDescription: WINDOWS_RELINK_IMAGE_TOOL_DESCRIPTION,
        admit: async (input, services) => {
            const request = WINDOWS_RELINK_IMAGE_CONTRACT.unadmittedInputSchema.parse(input);
            const sourceAdmission = await admitWindowsImageSource(request.source, services.imageFileInspector, check);
            const sourceModifiedAtMs = sourceAdmission.status === 'admitted' ? { sourceModifiedAtMs: Date.parse(sourceAdmission.modifiedAt) } : {};
            if (!request.apply) {
                if (sourceAdmission.status === 'blocked')
                    throw refusalOf(sourceAdmission);
                return { ...request, sourceAdmission, ...sourceModifiedAtMs };
            }
            const currentAdmission = await admitWindowsCurrentLink(request.expectedBefore.linkPath, services.imageFileInspector, check);
            const pixelDimensionsEqual = sourceAdmission.status === 'admitted' && currentAdmission.status === 'admitted' &&
                sourceAdmission.pixels !== null && currentAdmission.pixels !== null &&
                sourceAdmission.pixels.width === currentAdmission.pixels.width && sourceAdmission.pixels.height === currentAdmission.pixels.height;
            return { ...request, sourceAdmission, ...sourceModifiedAtMs, currentAdmission, pixelDimensionsEqual };
        },
        beforeHost: async (input) => {
            const { sourceAdmission, currentAdmission } = input;
            if (sourceAdmission === undefined || currentAdmission === undefined)
                throw new Error('Windows image relink reached dispatch without its source and current-link admissions.');
            if (sourceAdmission.status === 'blocked')
                throw refusalOf(sourceAdmission);
            if (currentAdmission.status === 'blocked')
                throw refusalOf(currentAdmission);
        },
    });
}
