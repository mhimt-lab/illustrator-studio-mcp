import { lstat } from 'node:fs/promises';
export async function windowsSameFileById(left, right) {
    const [first, second] = await Promise.all([lstat(left, { bigint: true }), lstat(right, { bigint: true })]);
    if (first.isSymbolicLink() || second.isSymbolicLink() || !first.isFile() || !second.isFile())
        return false;
    return first.dev === second.dev && first.ino === second.ino;
}
