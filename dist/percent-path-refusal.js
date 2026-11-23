import { nextStepsForCodes } from './blocked-guidance.js';
import { PATH_CONTAINS_PERCENT, PATH_CONTAINS_PERCENT_MESSAGE, percentPathFields } from './file-path.js';
export function percentPathRefusal(fields) {
    const refusal = { code: PATH_CONTAINS_PERCENT, message: PATH_CONTAINS_PERCENT_MESSAGE, fields: [...fields], next_steps: nextStepsForCodes([PATH_CONTAINS_PERCENT], PATH_CONTAINS_PERCENT_MESSAGE) };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(refusal) }] };
}
export function installPercentPathRefusal(server) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name, config, callback) => {
        const schema = config.inputSchema;
        const hasInput = schema !== undefined && schema !== null && !(typeof schema === 'object' && !('~standard' in schema) && !('shape' in schema) && Object.keys(schema).length === 0);
        return register(name, config, async (...args) => {
            if (hasInput) {
                const fields = percentPathFields(args[0]);
                if (fields.length > 0)
                    return percentPathRefusal(fields);
            }
            return await callback(...args);
        });
    });
}
