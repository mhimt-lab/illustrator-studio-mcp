import { constants as fsConstants } from 'node:fs';
export class PlatformUnsupportedError extends Error {
    primitive;
    code = 'PLATFORM_UNSUPPORTED';
    constructor(primitive) {
        super(`This platform does not provide ${primitive}, which safe file access requires.`);
        this.primitive = primitive;
        this.name = 'PlatformUnsupportedError';
    }
}
export function createPlatformPrimitives(source) {
    const flag = (name) => {
        const value = source.constants[name];
        if (typeof value !== 'number') {
            if (name === 'O_NOFOLLOW' || name === 'O_DIRECTORY' || name === 'O_NONBLOCK')
                throw new PlatformUnsupportedError(name);
            throw new Error(`node:fs does not provide ${name}.`);
        }
        return value;
    };
    return {
        noFollowReadFlags: () => flag('O_RDONLY') | flag('O_NOFOLLOW'),
        noFollowNonBlockingReadFlags: () => flag('O_RDONLY') | flag('O_NOFOLLOW') | flag('O_NONBLOCK'),
        noFollowDirectoryFlags: () => flag('O_RDONLY') | flag('O_DIRECTORY') | flag('O_NOFOLLOW'),
        directoryFlags: () => flag('O_RDONLY') | flag('O_DIRECTORY'),
        exclusiveCreateNoFollowFlags: () => flag('O_WRONLY') | flag('O_CREAT') | flag('O_EXCL') | flag('O_NOFOLLOW'),
        currentUid() {
            const getuid = source.getuid;
            if (typeof getuid !== 'function')
                throw new PlatformUnsupportedError('process.getuid');
            return getuid();
        },
        currentUidForDiagnostics() {
            const getuid = source.getuid;
            return typeof getuid === 'function' ? String(getuid()) : 'unknown';
        },
    };
}
const platform = createPlatformPrimitives({
    constants: fsConstants,
    get getuid() {
        return typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined;
    },
});
export const { noFollowReadFlags, noFollowNonBlockingReadFlags, noFollowDirectoryFlags, directoryFlags, exclusiveCreateNoFollowFlags, currentUid, currentUidForDiagnostics, } = platform;
