import { IllustratorOperationsCore } from '../../illustrator-operations-core.js';
export class CreateRectangleOperations extends IllustratorOperationsCore {
    async createRectangle(input) {
        return await this.executeAdapter('create_rectangle', input);
    }
}
