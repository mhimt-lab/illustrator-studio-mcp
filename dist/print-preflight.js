export const PRINT_PREFLIGHT_LIMITS = {
    pageItems: 5_000,
    images: 200,
    findings: 500,
};
const sectionCategories = [
    'color', 'overprint', 'transparency', 'raster_effect', 'bleed',
    'geometry', 'stroke', 'font', 'image', 'layer',
];
function truncateUtf16(value, limit) {
    if (value.length <= limit)
        return value;
    let end = limit;
    const previous = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF)
        end -= 1;
    return value.slice(0, end);
}
function imageTarget(item) {
    return {
        kind: 'object',
        uuid: item.object.uuid,
        type: item.object.type,
        name: item.object.name,
    };
}
function imageFindings(items, conditions, eligibility) {
    const findings = [];
    let indeterminate = false;
    const add = (item, code, severity, message, actual, expected) => findings.push({
        category: 'image',
        code,
        severity,
        message: truncateUtf16(message, 500),
        target: imageTarget(item),
        actual: actual === null ? null : truncateUtf16(actual, 2_000),
        expected: expected === null ? null : truncateUtf16(expected, 2_000),
    });
    for (const item of items) {
        const printState = eligibility?.get(item.object.uuid);
        if (eligibility !== null) {
            if (printState?.visible === false || printState?.printable === false)
                continue;
            if (printState?.visible !== true || printState?.printable !== true) {
                indeterminate = true;
                add(item, 'image_print_state_unavailable', 'warning', 'Effective image visibility or printability is unavailable.', 'effective print state unavailable', 'effective visible=true and printable=true');
                continue;
            }
        }
        if (item.currentFile.status === 'missing') {
            add(item, 'image_link_missing', 'error', item.currentFile.message, item.currentFile.path, 'linked file available');
        }
        else if (item.currentFile.status === 'unavailable') {
            indeterminate = true;
            add(item, 'image_file_inspection_unavailable', 'warning', item.currentFile.message, item.currentFile.reason, 'current file inspection available');
        }
        if (item.effectivePpi.status === 'unavailable') {
            indeterminate = true;
            add(item, 'image_effective_ppi_unavailable', 'warning', item.effectivePpi.message, item.effectivePpi.reason, `>= ${conditions.minimumEffectivePpi} ppi`);
        }
        else if (item.effectivePpi.value.x < conditions.minimumEffectivePpi ||
            item.effectivePpi.value.y < conditions.minimumEffectivePpi) {
            add(item, 'image_effective_ppi_below_threshold', 'error', `Effective PPI is below ${conditions.minimumEffectivePpi}.`, `${item.effectivePpi.value.x} x ${item.effectivePpi.value.y}`, `>= ${conditions.minimumEffectivePpi} on both axes`);
        }
        const colorSpace = item.color.space;
        if (colorSpace.status === 'unavailable') {
            indeterminate = true;
            add(item, 'image_color_space_unavailable', 'warning', colorSpace.message, colorSpace.reason, conditions.allowedImageColorSpaces.join(', '));
        }
        else if (!conditions.allowedImageColorSpaces.includes(colorSpace.value)) {
            add(item, 'image_color_space_disallowed', 'error', `Image color space ${colorSpace.value} is not allowed by the print conditions.`, colorSpace.value, conditions.allowedImageColorSpaces.join(', '));
        }
        if (conditions.requireLinkedImageIcc && item.color.provenance === 'linked_source_file') {
            if (item.color.icc.status === 'unavailable') {
                indeterminate = true;
                add(item, 'image_icc_unavailable', 'warning', item.color.icc.message, item.color.icc.reason, 'linked image ICC present');
            }
            else if (!item.color.icc.value.present) {
                add(item, 'image_icc_missing', 'error', 'The linked image has no ICC profile.', 'absent', 'present');
            }
        }
    }
    return { findings, indeterminate };
}
function sectionStatus(category, findings, indeterminate, conditions) {
    if (category === 'bleed' && Object.values(conditions.requiredBleedPt).every((value) => value === 0)) {
        return 'not_requested';
    }
    const categoryFindings = findings.filter((finding) => finding.category === category);
    if (categoryFindings.some((finding) => finding.severity === 'error'))
        return 'fail';
    if (indeterminate.has(category))
        return 'indeterminate';
    if (categoryFindings.some((finding) => finding.severity === 'warning'))
        return 'review';
    return 'pass';
}
export function createPrintPreflightResult(host, imageItems, imageComplete, conditions, imageEligibility = null) {
    const image = imageFindings(imageItems, conditions, imageEligibility);
    const indeterminate = new Set(host.indeterminateCategories);
    if (!imageComplete || image.indeterminate)
        indeterminate.add('image');
    if (!host.scan.pageItemsComplete || !host.scan.findingsComplete) {
        indeterminate.add('completeness');
        for (const category of sectionCategories)
            indeterminate.add(category);
    }
    const imageLimitFinding = imageComplete
        ? null
        : {
            category: 'completeness',
            code: 'image_scan_limit_reached',
            severity: 'warning',
            message: 'The document contains more images than the complete preflight limit.',
            target: { kind: 'document' },
            actual: `> ${PRINT_PREFLIGHT_LIMITS.images}`,
            expected: `<= ${PRINT_PREFLIGHT_LIMITS.images}`,
        };
    const allFindings = [
        ...host.findings,
        ...image.findings,
        ...(imageLimitFinding === null ? [] : [imageLimitFinding]),
    ];
    const totalFindingCount = host.scan.findingCount
        + image.findings.length
        + (imageLimitFinding === null ? 0 : 1);
    const findingsComplete = totalFindingCount <= PRINT_PREFLIGHT_LIMITS.findings
        && host.scan.findingsComplete;
    let findings;
    if (findingsComplete) {
        findings = allFindings;
    }
    else {
        const truncation = {
            category: 'completeness',
            code: 'findings_truncated',
            severity: 'warning',
            message: 'The finding list exceeded the bounded output limit.',
            target: { kind: 'document' },
            actual: String(totalFindingCount),
            expected: `<= ${PRINT_PREFLIGHT_LIMITS.findings}`,
        };
        const reserved = imageLimitFinding === null
            ? [truncation]
            : [truncation, imageLimitFinding];
        findings = [
            ...allFindings
                .filter((finding) => finding !== imageLimitFinding)
                .slice(0, PRINT_PREFLIGHT_LIMITS.findings - reserved.length),
            ...reserved,
        ];
        indeterminate.add('completeness');
        for (const category of sectionCategories)
            indeterminate.add(category);
    }
    const errors = findings.filter((finding) => finding.severity === 'error').length;
    const warnings = findings.filter((finding) => finding.severity === 'warning').length;
    const infos = findings.filter((finding) => finding.severity === 'info').length;
    const complete = host.scan.pageItemsComplete && findingsComplete && imageComplete && indeterminate.size === 0;
    const verdict = errors > 0
        ? 'fail'
        : !complete
            ? 'indeterminate'
            : warnings > 0
                ? 'review'
                : 'pass';
    const sections = Object.fromEntries(sectionCategories.map((category) => [
        category,
        sectionStatus(category, findings, indeterminate, conditions),
    ]));
    return {
        document: host.document,
        conditions,
        verdict,
        complete,
        absenceConclusive: complete,
        sections,
        counts: {
            totalPageItems: host.scan.totalPageItems,
            scannedPageItems: host.scan.scannedPageItems,
            totalImages: host.scan.totalImages,
            scannedImages: imageItems.length,
            findings: Math.max(totalFindingCount, findings.length),
            errors,
            warnings,
            infos,
        },
        facts: host.facts,
        findings,
    };
}
