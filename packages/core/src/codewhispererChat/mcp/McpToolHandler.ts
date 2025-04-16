import { McpHub } from './McpHub'
import { ToolManager } from '../tools/toolManager'
import { getLogger } from '../../shared/logger/logger'

/**
 * Handles integration between McpHub and ToolManager
 */
export class McpToolHandler {
    private mcpHub: McpHub

    constructor(mcpHub: McpHub) {
        this.mcpHub = mcpHub
        
        // Register the MCP Hub with the ToolManager
        getLogger().info('McpToolHandler: Registering MCP Hub with ToolManager')
        const toolManager = ToolManager.getInstance()
        toolManager.setMcpToolProvider(mcpHub)
        getLogger().info('McpToolHandler: MCP Hub registered successfully')
    }

    /**
     * Get the McpHub instance
     */
    public getMcpHub(): McpHub {
        return this.mcpHub
    }
}
