import { z } from 'zod';
import { summarizeValidationFailure } from './tool-arguments.js';
export function installToolValidationErrors(server) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name, config, callback) => {
        return register(name, config, async (...args) => {
            try {
                return await callback(...args);
            }
            catch (error) {
                if (!(error instanceof z.ZodError))
                    throw error;
                throw new Error(`Validation failed while running ${name}: ${summarizeValidationFailure(error)}`, { cause: error });
            }
        });
    });
}
