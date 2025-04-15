/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolManager } from './toolManager'
import { getLogger } from '../../shared/logger/logger'
import { ToolkitError } from '../../shared/errors'

/**
 * Handles execution of MCP tools
 */
export class McpToolExecutor {
    /**
     * Execute an MCP tool
     * @param toolName The name of the MCP tool
     * @param args The arguments for the tool
     * @returns The result of the tool execution
     */
    public static async execute(toolName: string, args: any): Promise<any> {
        const toolManager = ToolManager.getInstance()
        
        if (!toolManager.isMcpTool(toolName)) {
            throw new ToolkitError(`Not an MCP tool: ${toolName}`)
        }
        
        try {
            getLogger().debug(`Executing MCP tool: ${toolName} with args: ${JSON.stringify(args)}`)
            return await toolManager.executeMcpTool(toolName, args)
        } catch (error) {
            getLogger().error(`Error executing MCP tool ${toolName}: ${error}`)
            throw new ToolkitError(`Failed to execute MCP tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
}
