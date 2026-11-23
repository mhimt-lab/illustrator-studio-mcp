import { CREATE_AREA_TEXT_ADAPTER_IDENTITY } from '../adapters/create-area-text-adapter.js';
import { TRANSFORM_OBJECT_ADAPTER_IDENTITY } from '../adapters/transform-object-adapter.js';
import { ALIGN_OBJECTS_ADAPTER_IDENTITY } from '../adapters/align-objects-adapter.js';
import { SET_OBJECT_STATE_ADAPTER_IDENTITY } from '../adapters/set-object-state-adapter.js';
import { SET_STACKING_ORDER_ADAPTER_IDENTITY } from '../adapters/set-stacking-order-adapter.js';
import { DUPLICATE_OBJECT_ADAPTER_IDENTITY } from '../adapters/duplicate-object-adapter.js';
import { GROUP_OBJECTS_ADAPTER_IDENTITY } from '../adapters/group-objects-adapter.js';
import { CREATE_LAYER_ADAPTER_IDENTITY } from '../adapters/create-layer-adapter.js';
import { SET_LAYER_STATE_ADAPTER_IDENTITY } from '../adapters/set-layer-state-adapter.js';
import { MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY } from '../adapters/move-object-to-layer-adapter.js';
import { SET_PATH_APPEARANCE_ADAPTER_IDENTITY } from '../adapters/set-path-appearance-adapter.js';
import { CREATE_SHAPE_ADAPTER_IDENTITY } from '../adapters/create-shape-adapter.js';
import { CREATE_POINT_TEXT_ADAPTER_IDENTITY } from '../adapters/create-point-text-adapter.js';
import { CREATE_RECTANGLE_ADAPTER_IDENTITY } from '../adapters/create-rectangle-adapter.js';
import { REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY } from '../adapters/replace-area-text-range-adapter.js';
import { REPLACE_POINT_TEXT_ADAPTER_IDENTITY } from '../adapters/replace-point-text-adapter.js';
import { REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY } from '../adapters/replace-point-text-batch-adapter.js';
import { REPLACE_TEXT_RANGE_ADAPTER_IDENTITY } from '../adapters/replace-text-range-adapter.js';
import { SET_TEXT_STYLE_ADAPTER_IDENTITY } from '../adapters/set-text-style-adapter.js';
import { WINDOWS_PLACE_IMAGE_ADAPTER_IDENTITY } from './place-image.js';
import { WINDOWS_RELINK_IMAGE_ADAPTER_IDENTITY } from './relink-image.js';
import { WINDOWS_STROKE_ADAPTER_IDENTITY } from './set-stroke-style.js';
import { WINDOWS_DUPLICATE_ADAPTER_IDENTITY } from './duplicate-object.js';
export const WINDOWS_CANDIDATE_MUTATIONS_ENV = 'ILLUSTRATOR_STUDIO_MCP_WINDOWS_CANDIDATE_MUTATIONS';
const OPERATIONS = Object.freeze({
    create_rectangle: Object.freeze({ tool: 'illustrator_create_rectangle', adapterIdentity: CREATE_RECTANGLE_ADAPTER_IDENTITY }),
    replace_point_text: Object.freeze({ tool: 'illustrator_replace_point_text', adapterIdentity: REPLACE_POINT_TEXT_ADAPTER_IDENTITY }),
    replace_point_text_batch: Object.freeze({ tool: 'illustrator_replace_point_text_batch', adapterIdentity: REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY }),
    replace_text_range: Object.freeze({ tool: 'illustrator_replace_text_range', adapterIdentity: REPLACE_TEXT_RANGE_ADAPTER_IDENTITY }),
    replace_area_text_range: Object.freeze({ tool: 'illustrator_replace_area_text_range', adapterIdentity: REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY }),
    set_text_style: Object.freeze({ tool: 'illustrator_set_text_style', adapterIdentity: SET_TEXT_STYLE_ADAPTER_IDENTITY }),
    create_point_text: Object.freeze({ tool: 'illustrator_create_point_text', adapterIdentity: CREATE_POINT_TEXT_ADAPTER_IDENTITY }),
    create_area_text: Object.freeze({ tool: 'illustrator_create_area_text', adapterIdentity: CREATE_AREA_TEXT_ADAPTER_IDENTITY }),
    set_stroke_style: Object.freeze({ tool: 'illustrator_set_stroke_style', adapterIdentity: WINDOWS_STROKE_ADAPTER_IDENTITY }),
    transform_object: Object.freeze({ tool: 'illustrator_transform_object', adapterIdentity: TRANSFORM_OBJECT_ADAPTER_IDENTITY }),
    align_objects: Object.freeze({ tool: 'illustrator_align_objects', adapterIdentity: ALIGN_OBJECTS_ADAPTER_IDENTITY }),
    set_object_state: Object.freeze({ tool: 'illustrator_set_object_state', adapterIdentity: SET_OBJECT_STATE_ADAPTER_IDENTITY }),
    set_stacking_order: Object.freeze({ tool: 'illustrator_set_stacking_order', adapterIdentity: SET_STACKING_ORDER_ADAPTER_IDENTITY }),
    duplicate_object: Object.freeze({ tool: 'illustrator_duplicate_object', adapterIdentity: DUPLICATE_OBJECT_ADAPTER_IDENTITY }),
    duplicate_object_colour_profile: Object.freeze({ tool: 'illustrator_duplicate_object', adapterIdentity: WINDOWS_DUPLICATE_ADAPTER_IDENTITY }),
    group_objects: Object.freeze({ tool: 'illustrator_group_objects', adapterIdentity: GROUP_OBJECTS_ADAPTER_IDENTITY }),
    create_layer: Object.freeze({ tool: 'illustrator_create_layer', adapterIdentity: CREATE_LAYER_ADAPTER_IDENTITY }),
    set_layer_state: Object.freeze({ tool: 'illustrator_set_layer_state', adapterIdentity: SET_LAYER_STATE_ADAPTER_IDENTITY }),
    move_object_to_layer: Object.freeze({ tool: 'illustrator_move_object_to_layer', adapterIdentity: MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY }),
    set_path_appearance: Object.freeze({ tool: 'illustrator_set_path_appearance', adapterIdentity: SET_PATH_APPEARANCE_ADAPTER_IDENTITY }),
    create_shape: Object.freeze({ tool: 'illustrator_create_shape', adapterIdentity: CREATE_SHAPE_ADAPTER_IDENTITY }),
    create_document: Object.freeze({ tool: 'illustrator_create_document', hostCommand: 'create_document' }),
    close_document: Object.freeze({ tool: 'illustrator_close_document', hostCommand: 'close_document' }),
    open_document: Object.freeze({ tool: 'illustrator_open_document', hostCommand: 'open_document' }),
    place_image: Object.freeze({ tool: 'illustrator_place_image', adapterIdentity: WINDOWS_PLACE_IMAGE_ADAPTER_IDENTITY }),
    relink_image: Object.freeze({ tool: 'illustrator_relink_image', adapterIdentity: WINDOWS_RELINK_IMAGE_ADAPTER_IDENTITY }),
    create_backup: Object.freeze({ tool: 'illustrator_create_backup', hostCommands: Object.freeze(['backup_open_restore_test', 'backup_close_restore_test']) }),
    reconcile_backup: Object.freeze({ tool: 'illustrator_reconcile_backup', hostCommands: Object.freeze(['backup_close_restore_test']) }),
    save_document: Object.freeze({ tool: 'illustrator_save_document', hostCommand: 'save_document' }),
});
export const WINDOWS_DEFAULT_PUBLISHED_OPERATIONS = Object.freeze([
    'create_rectangle', 'replace_point_text', 'replace_point_text_batch', 'replace_text_range', 'replace_area_text_range', 'set_text_style',
    'create_point_text', 'create_area_text', 'set_stroke_style',
    'transform_object', 'align_objects', 'set_object_state', 'set_stacking_order', 'duplicate_object', 'group_objects', 'create_layer', 'set_layer_state',
    'move_object_to_layer', 'set_path_appearance', 'create_shape',
    'place_image', 'relink_image',
    'create_document', 'close_document', 'open_document',
]);
export const WINDOWS_CANDIDATE_OPERATIONS = Object.freeze(Object.keys(OPERATIONS).filter((name) => !WINDOWS_DEFAULT_PUBLISHED_OPERATIONS.includes(name)));
export const WINDOWS_NO_MUTATIONS = Object.freeze({
    operations: Object.freeze([]), tools: new Set(), adapterIdentities: Object.freeze([]), hostCommands: Object.freeze([]),
});
function publicationOf(operations) {
    const chosen = operations.map((name) => OPERATIONS[name]);
    return Object.freeze({
        operations: Object.freeze([...operations]), tools: new Set(chosen.map((entry) => entry.tool)),
        adapterIdentities: Object.freeze(chosen.flatMap((entry) => 'adapterIdentity' in entry ? [entry.adapterIdentity] : [])),
        hostCommands: Object.freeze([...new Set(chosen.flatMap((entry) => 'hostCommand' in entry ? [entry.hostCommand] : 'hostCommands' in entry ? entry.hostCommands : []))]),
    });
}
export const WINDOWS_DEFAULT_MUTATION_PUBLICATION = publicationOf(WINDOWS_DEFAULT_PUBLISHED_OPERATIONS);
export const WINDOWS_DEFAULT_PUBLISHED_TOOLS = WINDOWS_DEFAULT_MUTATION_PUBLICATION.tools;
export function parseWindowsCandidateMutations(env) {
    const raw = env[WINDOWS_CANDIDATE_MUTATIONS_ENV]?.trim();
    if (!raw)
        return WINDOWS_DEFAULT_MUTATION_PUBLICATION;
    const named = raw.split(',').map((name) => name.trim());
    for (const name of named) {
        if (!Object.hasOwn(OPERATIONS, name)) {
            throw new Error(`${WINDOWS_CANDIDATE_MUTATIONS_ENV} names unknown candidate "${name}"; allowed: ${Object.keys(OPERATIONS).join(', ')}.`);
        }
    }
    return publicationOf([...new Set([...WINDOWS_DEFAULT_PUBLISHED_OPERATIONS, ...named])]);
}
