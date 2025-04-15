/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolManager } from '../../../toolManager'
import { McpToolExecutor } from '../../../tools/mcpToolExecutor'
import { getLogger } from '../../../../shared/logger/logger'

/**
 * Utility class for handling tool operations
 */
export class ToolUtils {
    /**
     * Process a tool use request
     * @param toolUse The tool use request
     * @returns The processed tool
     */
    public static async processToolUse(toolUse: any): Promise<any> {
        const toolManager = ToolManager.getInstance()
        const toolName = toolUse.name
        
        // Check if this is an MCP tool
        if (toolManager.isMcpTool(toolName)) {
            getLogger().debug(`Processing MCP tool: ${toolName}`)
            return await McpToolExecutor.execute(toolName, toolUse.input)
        }
        
        // Handle standard tools
        return this.tryFromToolUse(toolUse)
    }
    
    /**
     * Try to create a tool from a tool use request
     * @param toolUse The tool use request
     * @returns The tool
     */
    public static tryFromToolUse(toolUse: any): any {
        // Existing implementation for standard tools
        // This is a placeholder - the actual implementation would depend on the existing code
        return { type: 'standard', tool: toolUse }
    }
    
    /**
     * Check if a tool requires user acceptance
     * @param tool The tool
     * @returns Validation result
     */
    public static requiresAcceptance(tool: any): { requiresAcceptance: boolean } {
        // For MCP tools, we might want to require acceptance for certain operations
        if (tool.type === 'mcp') {
            // Implement logic to determine if this MCP tool requires acceptance
            return { requiresAcceptance: true }
        }
        
        // Default implementation for standard tools
        return { requiresAcceptance: false }
    }
    
    /**
     * Queue a description for a tool
     * @param tool The tool
     * @param chatStream The chat stream
     */
    public static async queueDescription(tool: any, chatStream: any): Promise<void> {
        // Implementation would depend on the existing code
    }
}
