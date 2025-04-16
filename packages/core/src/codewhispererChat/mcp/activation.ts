import * as vscode from 'vscode'
import { McpHub } from './McpHub'
import { McpToolHandler } from './McpToolHandler'
import { getLogger } from '../../shared/logger/logger'

/**
 * Initializes the MCP components for Amazon Q
 * 
 * This function creates and configures the McpHub and McpToolHandler instances
 * which are responsible for connecting to MCP servers configured in ~/.aws/amazonq/mcp.json
 * and making their tools available to the ToolManager.
 * 
 * @param context The extension context
 * @returns The initialized McpToolHandler instance
 */
export async function initializeMcp(context: vscode.ExtensionContext): Promise<McpToolHandler> {
    getLogger().info('Initializing MCP components')
    
    try {
        // Create the McpHub instance with the extension version
        const clientVersion = context.extension?.packageJSON?.version || '1.0.0'
        getLogger().info(`Creating McpHub with client version: ${clientVersion}`)
        const mcpHub = new McpHub(clientVersion)
        getLogger().info('McpHub created successfully')
        
        // Create the McpToolHandler which will register the MCP Hub with the ToolManager
        getLogger().info('Creating McpToolHandler')
        const mcpToolHandler = new McpToolHandler(mcpHub)
        getLogger().info('McpToolHandler created successfully')
        
        // Register for disposal when the extension is deactivated
        context.subscriptions.push({
            dispose: () => {
                getLogger().info('Disposing MCP components')
                mcpHub.dispose()
            }
        })
        
        getLogger().info('MCP components initialized successfully')
        return mcpToolHandler
    } catch (error) {
        getLogger().error(`Error initializing MCP components: ${error}`)
        throw error
    }
}
