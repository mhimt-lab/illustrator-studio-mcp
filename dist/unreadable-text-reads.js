function reasonOf(number) {
    if (number === 1302)
        return 'host_no_such_element';
    if (number === 1220)
        return 'host_illegal_argument';
    return 'host_error';
}
function guidanceOf(evidence, reason) {
    const code = evidence.hostErrorNumber === null ? 'no error number' : `error ${evidence.hostErrorNumber}`;
    const kind = reason === 'host_no_such_element' ? 'No such element' : reason === 'host_illegal_argument' ? 'Illegal Argument' : 'host error';
    if (evidence.scope === 'paragraph') {
        return `Illustrator could not read ${evidence.attribute} (${code}, ${kind}). The other paragraphs, the style runs and the fonts were read. ` +
            'Do not treat the frame as absent or skip it silently: tell the user which paragraph could not be read.';
    }
    return `Illustrator stopped reading the text style runs at ${evidence.attribute} (${code}, ${kind}). The style runs, fonts and missing fonts are returned up to that point ` +
        'and are marked read_failed: do not treat them as complete.';
}
export function describeUnreadableTextReads(evidence) {
    return evidence.map((entry) => {
        const reason = reasonOf(entry.hostErrorNumber);
        return { scope: entry.scope, attribute: entry.attribute, index: entry.index, reason, hostErrorNumber: entry.hostErrorNumber,
            guidance: guidanceOf(entry, reason) };
    });
}
