import { canonicalSha256 } from '../mutation-canonical.js';
import { assemblePlaceImageAdapter, buildPlaceImageContract, placeImageAdapterIdentity, placeImageScript, } from '../adapters/place-image-adapter.js';
import { WINDOWS_PLACE_IMAGE_PLATFORM } from './image-adapter-platform.js';
import { inspectWindowsLocalImage, WindowsImageRefusedError, windowsImageFormatOf, } from './image-source-admission.js';
import { checkLinkTargetsBeforeOpen } from './image-reparse-gate.js';
export const WINDOWS_PLACE_IMAGE_CONTRACT = buildPlaceImageContract(WINDOWS_PLACE_IMAGE_PLATFORM);
export const WINDOWS_PLACE_IMAGE_SCRIPT = placeImageScript(WINDOWS_PLACE_IMAGE_PLATFORM.host);
export const WINDOWS_PLACE_IMAGE_ADAPTER_IDENTITY = placeImageAdapterIdentity(canonicalSha256(WINDOWS_PLACE_IMAGE_SCRIPT));
export const WINDOWS_PLACE_IMAGE_TOOL_DESCRIPTION = 'Plan or place one external raster file (TIFF, JPEG or PNG; a local drive-letter path such as C:\\images\\logo.png plus its SHA-256) as a linked PlacedItem on an explicit layer path at an artboard-top-left anchor in points. On Windows the file is checked in Node before any Illustrator call and a violation is refused with a reason code, for the plan as for the apply: the path must be a plain local drive-letter path (no UNC, device, relative or alternate-stream path, at most 259 characters), no symbolic link, junction or reparse point may be traversed, a cloud placeholder (OneDrive Files On-Demand) is never opened, and the file must exist, be a regular file with the exact SHA-256, and have a TIFF, JPEG or PNG header (PSD is not available on Windows). Optional size: width or height (aspect kept), contain or cover in a width x height box at the anchor (centered; cover overflows without clipping), or stretch (non-uniform, by name only). For contain or cover, focal_point and align_to set the position; the plan returns requested and effective positions and the clamp. The plan returns the size and X and Y effective PPI; minimum_effective_ppi only warns per axis. Apply creates the item once, verifies it, and rolls back only its own item. Relink and embed are not part of this tool.';
export async function admitWindowsImageSourceOrThrow(source, inspector, check = checkLinkTargetsBeforeOpen) {
    const { resolvedPath, inspection } = await inspectWindowsLocalImage(source.path, 'source', inspector, check);
    if (inspection.file.sha256 !== source.sha256) {
        throw new WindowsImageRefusedError('source_hash_mismatch', `Source file SHA-256 ${inspection.file.sha256} does not match the requested ${source.sha256}.`);
    }
    const format = windowsImageFormatOf(inspection, 'source');
    const pixels = inspection.metadata.pixels;
    const ppi = inspection.metadata.nativePpi;
    return {
        status: 'admitted', resolvedPath, bytes: inspection.file.bytes, modifiedAt: inspection.file.modifiedAt, sha256: inspection.file.sha256, format,
        pixels: pixels.status === 'available' ? { width: pixels.value.width, height: pixels.value.height } : null,
        nativePpi: ppi.status === 'available' ? { x: ppi.value.x, y: ppi.value.y } : null,
    };
}
export function blockedAdmissionOf(error) {
    if (!(error instanceof WindowsImageRefusedError))
        throw error;
    return { status: 'blocked', resolvedPath: null, reason: error.reasonCode, message: error.detail.slice(0, 500) };
}
export async function admitWindowsImageSource(source, inspector, check = checkLinkTargetsBeforeOpen) {
    try {
        return await admitWindowsImageSourceOrThrow(source, inspector, check);
    }
    catch (error) {
        return blockedAdmissionOf(error);
    }
}
export function refusalOf(admission) {
    return new WindowsImageRefusedError(admission.reason, admission.message);
}
export function createWindowsPlaceImageAdapter(options = {}) {
    const check = options.checkLinkTargets ?? checkLinkTargetsBeforeOpen;
    return assemblePlaceImageAdapter({
        contract: WINDOWS_PLACE_IMAGE_CONTRACT,
        commands: { read: { kind: 'read', script: WINDOWS_PLACE_IMAGE_SCRIPT }, mutation: { kind: 'mutation', script: WINDOWS_PLACE_IMAGE_SCRIPT } },
        toolDescription: WINDOWS_PLACE_IMAGE_TOOL_DESCRIPTION,
        admit: async (input, services) => {
            const request = WINDOWS_PLACE_IMAGE_CONTRACT.unadmittedInputSchema.parse(input);
            const admission = await admitWindowsImageSource(request.source, services.imageFileInspector, check);
            if (!request.apply && admission.status === 'blocked')
                throw refusalOf(admission);
            return { ...request, admission };
        },
        beforeHost: async (input) => {
            const admission = input.admission;
            if (admission === undefined)
                throw new Error('Windows image placement reached dispatch without a source admission.');
            if (admission.status === 'blocked')
                throw refusalOf(admission);
        },
    });
}
