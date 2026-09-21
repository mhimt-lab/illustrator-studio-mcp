import { constants } from 'node:fs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultStateRoot } from './command-store.js';
import { InvalidCursorError } from './domain.js';
import { ensurePrivateDirectory, isMissingPath, unsafePrivateState, validatePrivateDirectory, validatePrivateOwnerAndMode, } from './private-state.js';
const CURSOR_FORMAT = 'v1';
const KEY_BYTES = 32;
const KEY_FILE = 'cursor-signing-key.v1';
const STATE_FILE = 'cursor-signing-state.v1';
const KEY_RECORD_MAGIC = Buffer.from('ISMCP-CURSOR-SIGNING-KEY\0', 'ascii');
const KEY_RECORD_VERSION = 1;
const KEY_RECORD_HEADER_BYTES = KEY_RECORD_MAGIC.length + 3;
const KEY_RECORD_CHECKSUM_BYTES = 32;
const KEY_RECORD_BYTES = KEY_RECORD_HEADER_BYTES + KEY_BYTES + KEY_RECORD_CHECKSUM_BYTES;
const STATE_RECORD_MAGIC = Buffer.from('ISMCP-CURSOR-SIGNING-STATE\0', 'ascii');
const STATE_RECORD_VERSION = 1;
const STATE_INITIALIZING = 1;
const STATE_READY = 2;
const STATE_ID_BYTES = 16;
const STATE_KEY_DIGEST_BYTES = 32;
const STATE_RECORD_HEADER_BYTES = STATE_RECORD_MAGIC.length + 2 + STATE_ID_BYTES + STATE_KEY_DIGEST_BYTES;
const STATE_RECORD_BYTES = STATE_RECORD_HEADER_BYTES + 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
function canonicalJson(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('Cursor payload numbers must be finite.');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record).sort().map((key) => {
            if (record[key] === undefined)
                throw new Error('Cursor payload cannot contain undefined.');
            return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
        }).join(',')}}`;
    }
    throw new Error('Cursor payload contains an unsupported value.');
}
function decodeBase64Url(value) {
    if (!BASE64URL.test(value))
        throw new InvalidCursorError();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== value)
        throw new InvalidCursorError();
    return decoded;
}
function encodeKeyRecord(key) {
    if (key.length !== KEY_BYTES || key.every((byte) => byte === 0)) {
        throw unsafePrivateState('new key material is invalid.');
    }
    const header = Buffer.alloc(KEY_RECORD_HEADER_BYTES);
    KEY_RECORD_MAGIC.copy(header);
    header.writeUInt8(KEY_RECORD_VERSION, KEY_RECORD_MAGIC.length);
    header.writeUInt16BE(KEY_BYTES, KEY_RECORD_MAGIC.length + 1);
    const authenticated = Buffer.concat([header, key]);
    return Buffer.concat([authenticated, createHash('sha256').update(authenticated).digest()]);
}
function decodeKeyRecord(record) {
    if (record.length !== KEY_RECORD_BYTES) {
        throw unsafePrivateState('the key record has an invalid size or uses the unsupported legacy raw-key format.');
    }
    if (!record.subarray(0, KEY_RECORD_MAGIC.length).equals(KEY_RECORD_MAGIC)) {
        throw unsafePrivateState('the key record magic is invalid.');
    }
    if (record.readUInt8(KEY_RECORD_MAGIC.length) !== KEY_RECORD_VERSION) {
        throw unsafePrivateState('the key record version is unsupported.');
    }
    if (record.readUInt16BE(KEY_RECORD_MAGIC.length + 1) !== KEY_BYTES) {
        throw unsafePrivateState('the key record key length is invalid.');
    }
    const authenticated = record.subarray(0, KEY_RECORD_HEADER_BYTES + KEY_BYTES);
    const suppliedChecksum = record.subarray(KEY_RECORD_HEADER_BYTES + KEY_BYTES);
    const expectedChecksum = createHash('sha256').update(authenticated).digest();
    if (!timingSafeEqual(suppliedChecksum, expectedChecksum)) {
        throw unsafePrivateState('the key record integrity check failed.');
    }
    const key = Buffer.from(record.subarray(KEY_RECORD_HEADER_BYTES, KEY_RECORD_HEADER_BYTES + KEY_BYTES));
    if (key.every((byte) => byte === 0))
        throw unsafePrivateState('the key record contains an all-zero key.');
    return key;
}
function encodeStateRecord(state) {
    const authenticated = Buffer.alloc(STATE_RECORD_HEADER_BYTES);
    STATE_RECORD_MAGIC.copy(authenticated);
    authenticated.writeUInt8(STATE_RECORD_VERSION, STATE_RECORD_MAGIC.length);
    authenticated.writeUInt8(state.state, STATE_RECORD_MAGIC.length + 1);
    state.initializationId.copy(authenticated, STATE_RECORD_MAGIC.length + 2);
    state.keyDigest.copy(authenticated, STATE_RECORD_MAGIC.length + 2 + STATE_ID_BYTES);
    return Buffer.concat([authenticated, createHash('sha256').update(authenticated).digest()]);
}
function decodeStateRecord(record) {
    if (record.length !== STATE_RECORD_BYTES)
        throw unsafePrivateState('the signing-state record has an invalid size.');
    if (!record.subarray(0, STATE_RECORD_MAGIC.length).equals(STATE_RECORD_MAGIC)) {
        throw unsafePrivateState('the signing-state record magic is invalid.');
    }
    if (record.readUInt8(STATE_RECORD_MAGIC.length) !== STATE_RECORD_VERSION) {
        throw unsafePrivateState('the signing-state record version is unsupported.');
    }
    const state = record.readUInt8(STATE_RECORD_MAGIC.length + 1);
    if (state !== STATE_INITIALIZING && state !== STATE_READY) {
        throw unsafePrivateState('the signing-state record status is invalid.');
    }
    const authenticated = record.subarray(0, STATE_RECORD_HEADER_BYTES);
    const suppliedChecksum = record.subarray(STATE_RECORD_HEADER_BYTES);
    const expectedChecksum = createHash('sha256').update(authenticated).digest();
    if (!timingSafeEqual(suppliedChecksum, expectedChecksum)) {
        throw unsafePrivateState('the signing-state record integrity check failed.');
    }
    const initializationId = Buffer.from(record.subarray(STATE_RECORD_MAGIC.length + 2, STATE_RECORD_MAGIC.length + 2 + STATE_ID_BYTES));
    if (initializationId.every((byte) => byte === 0))
        throw unsafePrivateState('the signing-state initialization ID is invalid.');
    const keyDigest = Buffer.from(record.subarray(STATE_RECORD_MAGIC.length + 2 + STATE_ID_BYTES, STATE_RECORD_HEADER_BYTES));
    if (state === STATE_INITIALIZING && !keyDigest.every((byte) => byte === 0)) {
        throw unsafePrivateState('the initializing signing-state record contains an unexpected key digest.');
    }
    if (state === STATE_READY && keyDigest.every((byte) => byte === 0)) {
        throw unsafePrivateState('the ready signing-state record has no key digest.');
    }
    return { state, initializationId, keyDigest };
}
export class CursorSigner {
    stateRoot;
    keyPath;
    statePath;
    constructor(stateRoot = defaultStateRoot()) {
        this.stateRoot = stateRoot;
        this.keyPath = join(stateRoot, KEY_FILE);
        this.statePath = join(stateRoot, STATE_FILE);
    }
    async sign(payload) {
        const encodedPayload = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
        const authenticated = `${CURSOR_FORMAT}.${encodedPayload}`;
        const signature = createHmac('sha256', await this.loadKeyForSign()).update(authenticated, 'utf8').digest('base64url');
        return `${authenticated}.${signature}`;
    }
    async verify(cursor) {
        const parts = cursor.split('.');
        if (parts.length !== 3 || parts[0] !== CURSOR_FORMAT || !parts[1] || !parts[2])
            throw new InvalidCursorError();
        const payloadBytes = decodeBase64Url(parts[1]);
        const suppliedSignature = decodeBase64Url(parts[2]);
        if (suppliedSignature.length !== 32)
            throw new InvalidCursorError();
        const authenticated = `${parts[0]}.${parts[1]}`;
        const expectedSignature = createHmac('sha256', await this.loadExistingKey()).update(authenticated, 'utf8').digest();
        if (!timingSafeEqual(suppliedSignature, expectedSignature))
            throw new InvalidCursorError();
        try {
            const payload = JSON.parse(payloadBytes.toString('utf8'));
            if (canonicalJson(payload) !== payloadBytes.toString('utf8'))
                throw new InvalidCursorError();
            if (typeof payload !== 'object' || payload === null || !('version' in payload) || payload.version !== 1) {
                throw new InvalidCursorError();
            }
            return payload;
        }
        catch (error) {
            if (error instanceof InvalidCursorError)
                throw error;
            throw new InvalidCursorError();
        }
    }
    async loadKeyForSign() {
        await ensurePrivateDirectory(this.stateRoot, 'state root');
        let state;
        try {
            state = await this.readState();
        }
        catch (error) {
            if (!isMissingPath(error))
                throw error;
            if (await this.pathExists(this.keyPath)) {
                try {
                    state = await this.readState();
                }
                catch (recheckError) {
                    if (isMissingPath(recheckError)) {
                        throw unsafePrivateState('a signing key exists without its durable initialization state.');
                    }
                    throw recheckError;
                }
            }
            else {
                const initializationId = randomBytes(STATE_ID_BYTES);
                const claimed = await this.publishInitialState(initializationId);
                if (claimed)
                    return await this.initializeClaimedKey(initializationId);
                state = await this.waitForReadyState();
            }
        }
        if (state.state !== STATE_READY)
            state = await this.waitForReadyState();
        return await this.readBoundKey(state);
    }
    async loadExistingKey() {
        try {
            await validatePrivateDirectory(this.stateRoot, 0o700, 'state root');
        }
        catch (error) {
            if (isMissingPath(error))
                throw unsafePrivateState('the state root is missing; verification cannot initialize signing state.');
            throw error;
        }
        let state;
        try {
            state = await this.readState();
        }
        catch (error) {
            if (isMissingPath(error))
                throw unsafePrivateState('the durable signing-state record is missing; verification cannot initialize it.');
            throw error;
        }
        if (state.state !== STATE_READY) {
            throw unsafePrivateState('signing-state initialization is incomplete.');
        }
        return await this.readBoundKey(state);
    }
    async initializeClaimedKey(initializationId) {
        const temporaryPath = join(this.stateRoot, `.${KEY_FILE}.${randomUUID()}.tmp`);
        const handle = await open(temporaryPath, 'wx', 0o600);
        const record = encodeKeyRecord(randomBytes(KEY_BYTES));
        try {
            await handle.chmod(0o600);
            await handle.writeFile(record);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        try {
            await link(temporaryPath, this.keyPath);
            await this.syncStateRoot();
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
                throw unsafePrivateState('a signing key appeared during claimed first initialization.');
            }
            throw error;
        }
        finally {
            await unlink(temporaryPath).catch((error) => {
                if (!isMissingPath(error))
                    throw error;
            });
            await this.syncStateRoot();
        }
        const keyDigest = createHash('sha256').update(record).digest();
        await this.replaceState({ state: STATE_READY, initializationId, keyDigest });
        return decodeKeyRecord(record);
    }
    async publishInitialState(initializationId) {
        const temporaryPath = join(this.stateRoot, `.${STATE_FILE}.${randomUUID()}.tmp`);
        await this.writePrivateRecord(temporaryPath, encodeStateRecord({
            state: STATE_INITIALIZING,
            initializationId,
            keyDigest: Buffer.alloc(STATE_KEY_DIGEST_BYTES),
        }));
        try {
            await link(temporaryPath, this.statePath);
            await this.syncStateRoot();
            return true;
        }
        catch (error) {
            if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                throw error;
            return false;
        }
        finally {
            await unlink(temporaryPath).catch((error) => {
                if (!isMissingPath(error))
                    throw error;
            });
            await this.syncStateRoot();
        }
    }
    async replaceState(state) {
        const temporaryPath = join(this.stateRoot, `.${STATE_FILE}.${randomUUID()}.tmp`);
        await this.writePrivateRecord(temporaryPath, encodeStateRecord(state));
        try {
            await rename(temporaryPath, this.statePath);
            await this.syncStateRoot();
        }
        finally {
            await unlink(temporaryPath).catch((error) => {
                if (!isMissingPath(error))
                    throw error;
            });
        }
    }
    async writePrivateRecord(path, record) {
        const handle = await open(path, 'wx', 0o600);
        try {
            await handle.chmod(0o600);
            await handle.writeFile(record);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    async waitForReadyState() {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const state = await this.readState();
            if (state.state === STATE_READY)
                return state;
            await delay(10);
        }
        throw unsafePrivateState('signing-state initialization did not reach ready state.');
    }
    async readBoundKey(state) {
        let keyRecord;
        try {
            keyRecord = await this.readKey();
        }
        catch (error) {
            if (isMissingPath(error))
                throw unsafePrivateState('the signing key is missing from an initialized state root.');
            throw error;
        }
        const { key, digest } = keyRecord;
        if (!timingSafeEqual(state.keyDigest, digest)) {
            throw unsafePrivateState('the signing key does not match the durable initialization state.');
        }
        return key;
    }
    async readKey() {
        const record = await this.readPrivateRecord(this.keyPath, 'key');
        return { key: decodeKeyRecord(record), digest: createHash('sha256').update(record).digest() };
    }
    async readState() {
        return decodeStateRecord(await this.readPrivateRecord(this.statePath, 'signing-state'));
    }
    async readPrivateRecord(path, description) {
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink())
            throw unsafePrivateState(`the ${description} path must not be a symbolic link.`);
        if (!metadata.isFile())
            throw unsafePrivateState(`the ${description} path must be a regular file.`);
        validatePrivateOwnerAndMode(metadata, 0o600, `the existing ${description} file`);
        let handle;
        try {
            handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            throw unsafePrivateState(`the ${description} file could not be opened safely (${error instanceof Error ? error.message : String(error)}).`);
        }
        try {
            const openedMetadata = await handle.stat();
            if (!openedMetadata.isFile())
                throw unsafePrivateState(`the opened ${description} path is not a regular file.`);
            validatePrivateOwnerAndMode(openedMetadata, 0o600, `the opened ${description} file`);
            return await handle.readFile();
        }
        finally {
            await handle.close();
        }
    }
    async pathExists(path) {
        try {
            await lstat(path);
            return true;
        }
        catch (error) {
            if (isMissingPath(error))
                return false;
            throw error;
        }
    }
    async syncStateRoot() {
        const directory = await open(this.stateRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
            const metadata = await directory.stat();
            if (!metadata.isDirectory())
                throw unsafePrivateState('the opened state root is not a directory.');
            validatePrivateOwnerAndMode(metadata, 0o700, 'the opened state root');
            await directory.sync();
        }
        finally {
            await directory.close();
        }
    }
}
