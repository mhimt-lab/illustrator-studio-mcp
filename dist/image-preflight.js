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
export function createImagePreflightItem(host, inspection, minimumEffectivePpi) {
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
    };
}
