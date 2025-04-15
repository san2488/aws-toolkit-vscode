/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@amzn/codewhisperer-streaming'
import toolsJson from './tools/tool_index.json'
import { getLogger } from 'aws-core-vscode/shared'

/**
 * Interface for MCP Hub that provides tools
 */
export interface IMcpToolProvider {
    getServers(): any[]
    callTool(serverName: string, toolName: string, args: any): Promise<any>
}

/**
 * Manages tools from both local definitions and MCP servers
 */
export class ToolManager {
    private static instance: ToolManager
    private mcpToolProvider?: IMcpToolProvider
    private cachedTools?: Tool[]
    private cachedNoWriteTools?: Tool[]
    private lastCacheTime: number = 0
    private readonly CACHE_TTL_MS = 30000 // 30 seconds cache TTL

    private constructor() {}

    /**
     * Get the singleton instance of ToolManager
     */
    public static getInstance(): ToolManager {
        if (!ToolManager.instance) {
            ToolManager.instance = new ToolManager()
        }
        return ToolManager.instance
    }

    /**
     * Set the MCP tool provider
     * @param mcpToolProvider The MCP tool provider
     */
    public setMcpToolProvider(mcpToolProvider: IMcpToolProvider): void {
        this.mcpToolProvider = mcpToolProvider
        this.invalidateCache()
    }

    /**
     * Invalidate the tool cache
     */
    public invalidateCache(): void {
        this.cachedTools = undefined
        this.cachedNoWriteTools = undefined
        this.lastCacheTime = 0
    }

    /**
     * Get all available tools including MCP tools if available
     * @param includeMcpTools Whether to include MCP tools
     * @returns Array of tools
     */
    public async getTools(includeMcpTools: boolean = true): Promise<Tool[]> {
        // Check if cache is valid
        const now = Date.now()
        if (this.cachedTools && now - this.lastCacheTime < this.CACHE_TTL_MS) {
            return this.cachedTools
        }

        // Get base tools from tool_index.json
        const baseTools = Object.entries(toolsJson).map(([, toolSpec]) => ({
            toolSpecification: {
                ...toolSpec,
                inputSchema: { json: toolSpec.inputSchema },
            },
        }))

        // If MCP tools are not needed or no MCP provider is available, return base tools
        if (!includeMcpTools || !this.mcpToolProvider) {
            this.cachedTools = baseTools
            this.lastCacheTime = now
            return baseTools
        }

        try {
            // Get MCP tools and convert to the right format
            const mcpServers = this.mcpToolProvider.getServers()
            const mcpTools: Tool[] = []

            for (const server of mcpServers) {
                if (server.tools && Array.isArray(server.tools)) {
                    for (const tool of server.tools) {
                        if (tool.name) {
                            mcpTools.push({
                                toolSpecification: {
                                    name: `mcp_${server.name}_${tool.name}`,
                                    description: tool.description || `MCP tool ${tool.name} from server ${server.name}`,
                                    inputSchema: { json: tool.inputSchema || {} },
                                },
                            })
                        }
                    }
                }
            }

            getLogger().debug(`Added ${mcpTools.length} MCP tools to the tool list`)
            this.cachedTools = [...baseTools, ...mcpTools]
            this.lastCacheTime = now
            return this.cachedTools
        } catch (error) {
            getLogger().error(`Failed to get MCP tools: ${error}`)
            this.cachedTools = baseTools
            this.lastCacheTime = now
            return baseTools
        }
    }

    /**
     * Get tools that don't modify files (no write tools)
     * @returns Array of tools that don't modify files
     */
    public async getNoWriteTools(): Promise<Tool[]> {
        // Check if cache is valid
        const now = Date.now()
        if (this.cachedNoWriteTools && now - this.lastCacheTime < this.CACHE_TTL_MS) {
            return this.cachedNoWriteTools
        }

        const allTools = await this.getTools()
        
        // Filter out tools that can modify files
        this.cachedNoWriteTools = allTools.filter(tool => {
            const toolName = tool.toolSpecification?.name || ''
            
            // If it's an MCP tool, include it (we assume MCP tools are safe by default)
            if (toolName.startsWith('mcp_')) {
                return true
            }
            
            // Filter out known write tools
            return !['fsWrite', 'executeBash'].includes(toolName)
        })
        
        return this.cachedNoWriteTools
    }

    /**
     * Check if a tool is an MCP tool
     * @param toolName The name of the tool
     * @returns Whether the tool is an MCP tool
     */
    public isMcpTool(toolName: string): boolean {
        return toolName.startsWith('mcp_')
    }

    /**
     * Parse MCP tool name to get server and tool components
     * @param toolName The name of the MCP tool (format: mcp_serverName_toolName)
     * @returns Object containing server name and tool name
     */
    public parseMcpToolName(toolName: string): { serverName: string; mcpToolName: string } | null {
        if (!this.isMcpTool(toolName)) {
            return null
        }

        const parts = toolName.split('_')
        if (parts.length < 3) {
            return null
        }

        // The format is mcp_serverName_toolName
        // If there are more underscores in the tool name, we need to join them back
        const serverName = parts[1]
        const mcpToolName = parts.slice(2).join('_')

        return { serverName, mcpToolName }
    }

    /**
     * Execute an MCP tool
     * @param toolName The name of the MCP tool
     * @param args The arguments for the tool
     * @returns The result of the tool execution
     */
    public async executeMcpTool(toolName: string, args: any): Promise<any> {
        if (!this.mcpToolProvider) {
            throw new Error('No MCP tool provider available')
        }

        const parsedName = this.parseMcpToolName(toolName)
        if (!parsedName) {
            throw new Error(`Invalid MCP tool name: ${toolName}`)
        }

        const { serverName, mcpToolName } = parsedName
        return this.mcpToolProvider.callTool(serverName, mcpToolName, args)
    }
}
