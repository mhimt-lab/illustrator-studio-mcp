export const RESIZE_SPEC_NOTE = 'targetPixels: the pixel size that reaches targetPpi at the current placed size (matrix and intrinsic bounds), rounded up; ratio: targetPixels over the current pixels. visibleSourcePx: the clip mask in source pixels (origin top-left), clamped to the image and rounded outward; it is null when skippedReason gives the reason. A rotated, skewed or flipped image keeps targetPixels and skips visibleSourcePx.';
export const BLEED_SHORTFALL_NOTE = 'bleedShortfall (bleed_mm given): for the artboard holding the centre of the visible frame, every edge whose visible frame (clip mask, else the image) touches or passes the artboard edge within 0.5 pt gets shortfallMm/shortfallPx, how far the image pixels stop short of artboard edge + bleed (px at targetPpi, rounded up; 0 when they reach it). maskShortfallMm is how far the visible frame stops short; with shortfallMm 0 and maskShortfallMm above 0, widening the mask is enough. Other edges are null. The document bleed is not read; only bleed_mm is used.';
export const RESIZE_SKIP_REASONS = [
    'geometry_unavailable',
    'pixels_unavailable',
    'rotated_or_skewed',
    'flipped',
    'clip_state_unavailable',
    'mask_outside_image',
    'artboard_not_found',
];
export class ImageObjectRequiredError extends Error {
    constructor(uuid, type) {
        super(`PageItem ${JSON.stringify(uuid)} is ${JSON.stringify(type)}, not a PlacedItem or RasterItem.`);
        this.name = 'ImageObjectRequiredError';
    }
}
function message(reason) {
    return reason.replaceAll('_', ' ');
}
function unavailable(reason, value) {
    const normalized = value.length > 0 ? value : 'Image fact is unavailable.';
    return { status: 'unavailable', reason, message: normalized.slice(0, 500) };
}
function currentFile(host, inspection) {
    if (host.file.status === 'not_applicable')
        return host.file;
    if (host.file.status === 'missing') {
        return { ...host.file, message: (host.file.message || 'The linked file is missing.').slice(0, 500) };
    }
    if (host.file.status === 'unavailable') {
        return unavailable(host.file.reason, host.file.message);
    }
    if (inspection === null) {
        return unavailable('link_file_unavailable', 'The current linked file was not inspected.');
    }
    if (inspection.status === 'available')
        return { status: 'available', value: inspection.file };
    if (inspection.status === 'missing') {
        return { status: 'missing', path: inspection.path, message: 'The current linked file does not exist.' };
    }
    return { status: 'unavailable', reason: inspection.reason, message: inspection.message };
}
function embeddedPixels(host) {
    if (host.intrinsicBounds.status === 'unavailable') {
        return unavailable('pixels_unavailable', host.intrinsicBounds.message);
    }
    const value = host.intrinsicBounds.value;
    const width = Math.abs(value[2] - value[0]);
    const height = Math.abs(value[1] - value[3]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        return unavailable('embedded_pixel_dimensions_invalid', 'Embedded RasterItem intrinsic bounds do not contain positive integer pixel dimensions.');
    }
    return { status: 'available', value: { width, height } };
}
function effectivePpi(pixels, intrinsicBounds, matrix) {
    if (pixels.status !== 'available') {
        return {
            availability: unavailable('effective_ppi_pixels_unavailable', 'Pixel dimensions are unavailable.'),
            raw: null,
        };
    }
    if (intrinsicBounds.status !== 'available' || matrix.status !== 'available') {
        return {
            availability: unavailable('effective_ppi_geometry_unavailable', 'Intrinsic bounds or affine matrix are unavailable.'),
            raw: null,
        };
    }
    const width = Math.abs(intrinsicBounds.value[2] - intrinsicBounds.value[0]);
    const height = Math.abs(intrinsicBounds.value[1] - intrinsicBounds.value[3]);
    const xPoints = width * Math.hypot(matrix.value.a, matrix.value.b);
    const yPoints = height * Math.hypot(matrix.value.c, matrix.value.d);
    const x = pixels.value.width * 72 / xPoints;
    const y = pixels.value.height * 72 / yPoints;
    if (![width, height, xPoints, yPoints, x, y].every((value) => Number.isFinite(value) && value > 0)) {
        return {
            availability: unavailable('effective_ppi_invalid_zero', 'Effective-PPI geometry is zero, negative, or invalid.'),
            raw: null,
        };
    }
    const rounded = { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) };
    return { availability: { status: 'available', value: rounded }, raw: { x, y } };
}
function normalizeRasterColor(value) {
    const normalized = {
        'ImageColorSpace.RGB': 'RGB',
        'ImageColorSpace.CMYK': 'CMYK',
        'ImageColorSpace.Grayscale': 'Gray',
        'ImageColorSpace.Monochrome': 'Gray',
        'ImageColorSpace.Indexed': 'Indexed',
        'ImageColorSpace.LAB': 'Lab',
    };
    return normalized[value] ?? 'unknown';
}
function linkedMetadata(inspection) {
    if (inspection?.status === 'available') {
        return {
            format: inspection.metadata.format,
            pixels: inspection.metadata.pixels,
            nativePpi: inspection.metadata.nativePpi,
            color: {
                provenance: 'linked_source_file',
                space: inspection.metadata.colorSpace,
                icc: inspection.metadata.icc,
            },
        };
    }
    return {
        format: unavailable('source_format_unavailable', 'Current linked-source metadata is unavailable.'),
        pixels: unavailable('pixels_unavailable', 'Current linked-source pixel dimensions are unavailable.'),
        nativePpi: unavailable('native_ppi_unavailable', 'Current linked-source native PPI is unavailable.'),
        color: {
            provenance: 'unavailable',
            space: unavailable('color_space_unavailable', 'Current linked-source color space is unavailable.'),
            icc: unavailable('icc_unavailable', 'Current linked-source ICC metadata is unavailable.'),
        },
    };
}
function embeddedColor(host) {
    const space = host.raster.imageColorSpace.status === 'available'
        ? { status: 'available', value: normalizeRasterColor(host.raster.imageColorSpace.value) }
        : unavailable('color_space_unavailable', host.raster.imageColorSpace.message);
    return {
        provenance: 'embedded_illustrator_object',
        space,
        icc: unavailable('embedded_icc_unavailable', 'Illustrator does not expose embedded-object ICC identity.'),
        bitsPerChannel: host.raster.bitsPerChannel,
        channels: host.raster.channels,
        colorants: host.raster.colorants,
    };
}
const ORIENTATION_EPSILON = 1e-9;
const PIXEL_EPSILON = 1e-6;
const roundSix = (value) => Number(value.toFixed(6));
const clampPixel = (value, limit) => Math.min(Math.max(value, 0), limit);
function readPlacement(host) {
    if (host.intrinsicBounds.status !== 'available' || host.matrix.status !== 'available')
        return null;
    const intrinsic = host.intrinsicBounds.value;
    const intrinsicWidth = Math.abs(intrinsic[2] - intrinsic[0]);
    const intrinsicHeight = Math.abs(intrinsic[1] - intrinsic[3]);
    const matrix = host.matrix.value;
    const displayWidth = intrinsicWidth * Math.hypot(matrix.a, matrix.b);
    const displayHeight = intrinsicHeight * Math.hypot(matrix.c, matrix.d);
    if (![intrinsicWidth, intrinsicHeight, displayWidth, displayHeight].every((value) => Number.isFinite(value) && value > 0)) {
        return null;
    }
    const documentD = host.type === 'PlacedItem' ? -matrix.d : matrix.d;
    const orientationSkip = Math.abs(matrix.b) > ORIENTATION_EPSILON || Math.abs(matrix.c) > ORIENTATION_EPSILON
        ? 'rotated_or_skewed'
        : matrix.a < 0 || documentD < 0 ? 'flipped' : null;
    return { intrinsicWidth, intrinsicHeight, displayWidth, displayHeight, matrix, documentD, orientationSkip };
}
function imageDocumentRect(host, placement) {
    const width = placement.intrinsicWidth * placement.matrix.a;
    const height = placement.intrinsicHeight * placement.documentD;
    const centerX = (host.bounds[0] + host.bounds[2]) / 2;
    const centerY = (host.bounds[1] + host.bounds[3]) / 2;
    return { left: centerX - width / 2, right: centerX + width / 2, top: centerY + height / 2, bottom: centerY - height / 2 };
}
export function createResizeSpec(host, pixels, targetPpi, bleed) {
    const spec = createPixelResizeSpec(host, pixels, targetPpi);
    return bleed === undefined ? spec : { ...spec, bleedShortfall: createBleedShortfall(host, targetPpi, bleed) };
}
function createPixelResizeSpec(host, pixels, targetPpi) {
    const spec = {
        targetPpi: targetPpi, targetPixels: null, ratio: null, visibleSourcePx: null, skippedReason: null,
    };
    const placement = readPlacement(host);
    if (placement === null)
        return { ...spec, skippedReason: 'geometry_unavailable' };
    const targetWidth = Math.ceil(targetPpi * placement.displayWidth / 72 - PIXEL_EPSILON);
    const targetHeight = Math.ceil(targetPpi * placement.displayHeight / 72 - PIXEL_EPSILON);
    spec.targetPixels = { width: targetWidth, height: targetHeight };
    if (pixels.status === 'available') {
        spec.ratio = {
            width: roundSix(targetWidth / pixels.value.width),
            height: roundSix(targetHeight / pixels.value.height),
        };
    }
    if (placement.orientationSkip !== null)
        return { ...spec, skippedReason: placement.orientationSkip };
    if (pixels.status !== 'available')
        return { ...spec, skippedReason: 'pixels_unavailable' };
    if (host.clip === undefined || host.clip.status !== 'available')
        return { ...spec, skippedReason: 'clip_state_unavailable' };
    const pixelWidth = pixels.value.width;
    const pixelHeight = pixels.value.height;
    const mask = host.clip.value.mask;
    if (mask === null) {
        spec.visibleSourcePx = { left: 0, top: 0, right: pixelWidth, bottom: pixelHeight };
        return spec;
    }
    const rect = imageDocumentRect(host, placement);
    const imageWidth = rect.right - rect.left;
    const imageHeight = rect.top - rect.bottom;
    const maskLeft = Math.min(mask[0], mask[2]);
    const maskRight = Math.max(mask[0], mask[2]);
    const maskTop = Math.max(mask[1], mask[3]);
    const maskBottom = Math.min(mask[1], mask[3]);
    const left = clampPixel(Math.floor((maskLeft - rect.left) / imageWidth * pixelWidth + PIXEL_EPSILON), pixelWidth);
    const right = clampPixel(Math.ceil((maskRight - rect.left) / imageWidth * pixelWidth - PIXEL_EPSILON), pixelWidth);
    const top = clampPixel(Math.floor((rect.top - maskTop) / imageHeight * pixelHeight + PIXEL_EPSILON), pixelHeight);
    const bottom = clampPixel(Math.ceil((rect.top - maskBottom) / imageHeight * pixelHeight - PIXEL_EPSILON), pixelHeight);
    if (right <= left || bottom <= top)
        return { ...spec, skippedReason: 'mask_outside_image' };
    return { ...spec, visibleSourcePx: { left, top, right, bottom } };
}
const POINTS_PER_MM = 72 / 25.4;
const BLEED_TOUCH_TOLERANCE_PT = 0.5;
const BLEED_REACH_TOLERANCE_PT = 0.01;
function createBleedShortfall(host, targetPpi, bleed) {
    const result = { bleedMm: bleed.bleedMm, artboardIndex: null, edges: null, skippedReason: null };
    const placement = readPlacement(host);
    if (placement === null)
        return { ...result, skippedReason: 'geometry_unavailable' };
    if (placement.orientationSkip !== null)
        return { ...result, skippedReason: placement.orientationSkip };
    if (host.clip === undefined || host.clip.status !== 'available')
        return { ...result, skippedReason: 'clip_state_unavailable' };
    const rect = imageDocumentRect(host, placement);
    const mask = host.clip.value.mask;
    const visible = mask === null ? rect : {
        left: Math.min(mask[0], mask[2]), right: Math.max(mask[0], mask[2]),
        top: Math.max(mask[1], mask[3]), bottom: Math.min(mask[1], mask[3]),
    };
    const centerX = (visible.left + visible.right) / 2;
    const centerY = (visible.top + visible.bottom) / 2;
    const artboardIndex = bleed.artboards.findIndex((board) => centerX >= Math.min(board[0], board[2]) && centerX <= Math.max(board[0], board[2]) &&
        centerY >= Math.min(board[1], board[3]) && centerY <= Math.max(board[1], board[3]));
    if (artboardIndex < 0)
        return { ...result, skippedReason: 'artboard_not_found' };
    const board = bleed.artboards[artboardIndex];
    const artboard = {
        left: Math.min(board[0], board[2]), right: Math.max(board[0], board[2]),
        top: Math.max(board[1], board[3]), bottom: Math.min(board[1], board[3]),
    };
    const bleedPt = bleed.bleedMm * POINTS_PER_MM;
    const outward = {
        left: (rectangle) => artboard.left - rectangle.left,
        right: (rectangle) => rectangle.right - artboard.right,
        top: (rectangle) => rectangle.top - artboard.top,
        bottom: (rectangle) => artboard.bottom - rectangle.bottom,
    };
    const shortfall = (reach) => Math.max(0, bleedPt - reach);
    const edges = {};
    for (const name of ['left', 'top', 'right', 'bottom']) {
        if (outward[name](visible) < -BLEED_TOUCH_TOLERANCE_PT) {
            edges[name] = null;
            continue;
        }
        const pixelShortPt = shortfall(outward[name](rect));
        const maskShortPt = shortfall(outward[name](visible));
        const pixelsShort = pixelShortPt > BLEED_REACH_TOLERANCE_PT;
        edges[name] = {
            shortfallMm: pixelsShort ? roundSix(pixelShortPt / POINTS_PER_MM) : 0,
            shortfallPx: pixelsShort ? Math.ceil(pixelShortPt * targetPpi / 72 - PIXEL_EPSILON) : 0,
            maskShortfallMm: maskShortPt > BLEED_REACH_TOLERANCE_PT ? roundSix(maskShortPt / POINTS_PER_MM) : 0,
        };
    }
    return { ...result, artboardIndex, edges };
}
export function createImagePreflightItem(host, inspection, minimumEffectivePpi, targetPpi, bleed) {
    const linked = host.linkage.status === 'available' && host.linkage.value === 'linked';
    const embedded = host.linkage.status === 'available' && host.linkage.value === 'embedded';
    const metadata = linked
        ? linkedMetadata(inspection)
        : embedded
            ? {
                format: { status: 'not_applicable', reason: 'embedded_item' },
                pixels: embeddedPixels(host),
                nativePpi: unavailable('embedded_native_ppi_unavailable', 'Original native PPI is unavailable after embedding.'),
                color: embeddedColor(host),
            }
            : {
                format: unavailable('source_format_unavailable', 'Image link state is unavailable.'),
                pixels: unavailable('pixels_unavailable', 'Image link state is unavailable.'),
                nativePpi: unavailable('native_ppi_unavailable', 'Image link state is unavailable.'),
                color: {
                    provenance: 'unavailable',
                    space: unavailable('color_space_unavailable', 'Image link state is unavailable.'),
                    icc: unavailable('icc_unavailable', 'Image link state is unavailable.'),
                },
            };
    const effective = effectivePpi(metadata.pixels, host.intrinsicBounds, host.matrix);
    const file = currentFile(host, inspection);
    const warnings = [];
    if (file.status === 'missing') {
        warnings.push({ code: 'link_missing', severity: 'error', message: file.message });
    }
    else if (file.status === 'unavailable') {
        warnings.push({ code: 'file_inspection_unavailable', severity: 'warning', message: file.message });
    }
    if (effective.raw === null) {
        warnings.push({
            code: 'effective_ppi_unavailable',
            severity: 'warning',
            message: effective.availability.status === 'unavailable' ? effective.availability.message : message('unknown'),
        });
    }
    else {
        const comparable = effective.availability.status === 'available'
            ? effective.availability.value
            : effective.raw;
        const failingAxes = [];
        if (comparable.x < minimumEffectivePpi)
            failingAxes.push('x');
        if (comparable.y < minimumEffectivePpi)
            failingAxes.push('y');
        if (failingAxes.length > 0) {
            warnings.push({
                code: 'effective_ppi_below_threshold',
                severity: 'warning',
                message: `Effective PPI is below ${minimumEffectivePpi} on axis ${failingAxes.join(', ')}.`,
                threshold: minimumEffectivePpi,
                x: comparable.x,
                y: comparable.y,
                failingAxes,
            });
        }
    }
    return {
        object: {
            uuid: host.uuid,
            type: host.type,
            name: host.name,
            layer: host.layer,
            bounds: host.bounds,
            visibleBounds: host.visibleBounds,
            locked: host.locked,
            hidden: host.hidden,
        },
        linkage: host.linkage,
        currentFile: file,
        placementUpdate: linked
            ? unavailable('placement_update_state_unavailable', 'Illustrator ExtendScript does not expose a trustworthy changed-since-placement state.')
            : embedded
                ? { status: 'not_applicable', reason: 'embedded_item' }
                : unavailable('link_state_unavailable', 'Image link state is unavailable.'),
        sourceFormat: metadata.format,
        pixels: metadata.pixels,
        nativePpi: metadata.nativePpi,
        effectivePpi: effective.availability,
        color: metadata.color,
        warnings,
        ...(targetPpi === undefined ? {} : { resizeSpec: createResizeSpec(host, metadata.pixels, targetPpi, bleed) }),
    };
}
