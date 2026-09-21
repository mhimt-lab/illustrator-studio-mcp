const HOST_LOOKUP_FAILURE_TOKEN = 'getPageItemFromUuid';
export function textLookupFailureError(error, detail) {
    if (detail?.code !== undefined)
        return null;
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (!message.includes(HOST_LOOKUP_FAILURE_TOKEN))
        return null;
    return new Error('No PageItem with the requested UUID exists in the bound document.');
}
