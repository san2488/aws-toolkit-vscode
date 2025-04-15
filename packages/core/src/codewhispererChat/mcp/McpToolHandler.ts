/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpHub } from './McpHub'
import { ToolManager } from '../tools/toolManager'
import { getLogger } from '../../shared/logger/logger'

/**
 * Handles MCP tool integration with Amazon Q
 */
export class McpToolHandler {
    private mcpHub: McpHub

    constructor(mcpHub: McpHub) {
        this.mcpHub = mcpHub
        this.initializeToolManager()
    }

    /**
     * Initialize the ToolManager with the MCP Hub
     */
    private initializeToolManager(): void {
        const toolManager = ToolManager.getInstance()
        
        // Set the MCP Hub as the tool provider
        toolManager.setMcpToolProvider({
            getServers: () => this.mcpHub.getServers(),
            callTool: async (serverName: string, toolName: string, args: any) => {
                return this.mcpHub.callTool(serverName, toolName, args)
            }
        })
        
        getLogger().debug('MCP Tool Handler initialized and registered with ToolManager')
    }

    /**
     * Handle a tool use request
     * @param toolName The name of the tool
     * @param args The arguments for the tool
     * @returns The result of the tool execution
     */
    public async handleToolUse(toolName: string, args: any): Promise<any> {
        const toolManager = ToolManager.getInstance()
        
        if (!toolManager.isMcpTool(toolName)) {
            throw new Error(`Not an MCP tool: ${toolName}`)
        }
        
        try {
            const result = await toolManager.executeMcpTool(toolName, args)
            return this.formatToolResponse(result)
        } catch (error) {
            getLogger().error(`Error executing MCP tool ${toolName}: ${error}`)
            throw error
        }
    }

    /**
     * Format the MCP tool response to match the expected format
     * @param response The raw response from the MCP tool
     * @returns Formatted response
     */
    private formatToolResponse(response: any): any {
        // If the response is already in the expected format, return it as is
        if (response && response.content) {
            return response
        }

        // Format text responses
        if (typeof response === 'string') {
            return {
                content: [
                    {
                        type: 'text',
                        text: response
                    }
                ]
            }
        }

        // Format object responses
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2)
                }
            ]
        }
    }
}
