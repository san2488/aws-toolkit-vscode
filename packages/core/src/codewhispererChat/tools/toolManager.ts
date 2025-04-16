/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@amzn/codewhisperer-streaming'
import toolsJson from './tool_index.json'
import { getLogger } from '../../shared/logger/logger'
import { McpToolCallResponse } from '../mcp'

/**
 * Interface for MCP Hub that provides tools
 */
export interface IMcpToolProvider {
    getServers(): any[]
callTool(serverName: string, toolName: string, args: any): Promise<McpToolCallResponse>
}

/**
 * Manages tools from both local definitions and MCP servers
 */
export class ToolManager {
    private static instance: ToolManager
    private mcpToolProvider?: IMcpToolProvider
    private cachedTools: Tool[] = []
    private cachedNoWriteTools: Tool[] = []
    private lastCacheTime: number = 0
    private readonly CACHE_TTL_MS = 3000 // 30 seconds cache TTL

    /**
     * Constructor initializes both static and MCP tools
     */
    private constructor() {
        // Load static tools immediately
        this.loadStaticTools()
        
        getLogger().info(`ToolManager: Initialized with ${this.cachedTools.length} static tools`)
    }

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
     * Set the MCP tool provider and load MCP tools
     * @param mcpToolProvider The MCP tool provider
     */
    public setMcpToolProvider(mcpToolProvider: IMcpToolProvider): void {
        this.mcpToolProvider = mcpToolProvider
        
        // Load MCP tools immediately when provider is set
        this.loadMcpTools()
            .then(mcpTools => {
                // Add MCP tools to cached tools
                this.cachedTools = [...this.cachedTools.filter(tool => !tool.toolSpecification?.name?.startsWith('mcp_')), ...mcpTools]
                
                // Update no-write tools
                this.updateNoWriteTools()
                
                // Update cache timestamp
                this.lastCacheTime = Date.now()
                
                getLogger().info(`ToolManager: Added ${mcpTools.length} MCP tools, total tools: ${this.cachedTools.length}`)
            })
            .catch(error => {
                getLogger().error(`ToolManager: Failed to load MCP tools: ${error}`)
            })
    }

    /**
     * Invalidate the tool cache and reload all tools
     */
    public invalidateCache(): void {
        getLogger().info('ToolManager: Invalidating tool cache')
        
        // Reset cache timestamp to force reload
        this.lastCacheTime = 0
        
        // Reload all tools
        this.loadStaticTools()
        
        // Reload MCP tools if provider is available
        if (this.mcpToolProvider) {
            this.loadMcpTools()
                .then(mcpTools => {
                    this.cachedTools = [...this.cachedTools.filter(tool => !tool.toolSpecification?.name?.startsWith('mcp_')), ...mcpTools]
                    this.updateNoWriteTools()
                    this.lastCacheTime = Date.now()
                    getLogger().info(`ToolManager: Cache refreshed with ${this.cachedTools.length} total tools`)
                })
                .catch(error => {
                    getLogger().error(`ToolManager: Failed to refresh MCP tools: ${error}`)
                })
        }
    }

    /**
     * Get all available tools
     * @param forceRefresh Whether to force a refresh of the tools
     * @returns Array of tools
     */
    public async getTools(forceRefresh: boolean = false): Promise<Tool[]> {
        const now = Date.now()
        
        // Check if cache is valid and no refresh is forced
        if (!forceRefresh && now - this.lastCacheTime < this.CACHE_TTL_MS) {
            return this.cachedTools
        }
        
        // Reload static tools
        this.loadStaticTools()
        
        // Reload MCP tools if provider is available
        if (this.mcpToolProvider) {
            const mcpTools = await this.loadMcpTools()
            this.cachedTools = [...this.cachedTools.filter(tool => !tool.toolSpecification?.name?.startsWith('mcp_')), ...mcpTools]
            this.updateNoWriteTools()
        }
        
        this.lastCacheTime = now
        return this.cachedTools
    }

    /**
     * Get tools that don't modify files (no write tools)
     * @param forceRefresh Whether to force a refresh of the tools
     * @returns Array of tools that don't modify files
     */
    public async getNoWriteTools(forceRefresh: boolean = false): Promise<Tool[]> {
        // Ensure tools are up to date
        await this.getTools(forceRefresh)
        return this.cachedNoWriteTools
    }

    /**
     * Get all available tools synchronously
     * @returns Array of tools
     */
    public getToolsSync(): Tool[] {
        // If cache is expired, trigger a refresh in the background
        if (Date.now() - this.lastCacheTime >= this.CACHE_TTL_MS) {
            void this.getTools(true)
        }
        
        return this.cachedTools
    }

    /**
     * Get all available tools excluding write tools synchronously
     * @returns Array of tools excluding write tools
     */
    public getNoWriteToolsSync(): Tool[] {
        // If cache is expired, trigger a refresh in the background
        if (Date.now() - this.lastCacheTime >= this.CACHE_TTL_MS) {
            void this.getTools(true)
        }
        
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

        const parts = toolName.split('___')
        if (parts.length < 2) {
            return null
        }

        // The format is mcp_serverName_toolName
        // If there are more underscores in the tool name, we need to join them back
        const serverName = parts[0].replace(/^mcp_/g, '')
        const mcpToolName = parts[1]

        return { serverName, mcpToolName }
    }

    /**
     * Execute an MCP tool
     * @param toolName The name of the MCP tool
     * @param args The arguments for the tool
     * @returns The result of the tool execution
     */
    public async executeMcpTool(toolName: string, args: any): Promise<McpToolCallResponse> {
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

    /**
     * Load static tools from tool_index.json
     * @private
     */
    private loadStaticTools(): void {
        getLogger().info('ToolManager: Loading static tools from tool_index.json')
        
        const staticTools = Object.entries(toolsJson).map(([, toolSpec]) => ({
            toolSpecification: {
                ...toolSpec,
                inputSchema: { json: toolSpec.inputSchema },
            },
        }))
        
        // Keep any existing MCP tools
        const mcpTools = this.cachedTools.filter(tool => 
            tool.toolSpecification?.name?.startsWith('mcp_')
        )
        
        // Update cached tools with static tools and existing MCP tools
        this.cachedTools = [...staticTools, ...mcpTools]
        
        // Update no-write tools
        this.updateNoWriteTools()
        
        getLogger().info(`ToolManager: Loaded ${staticTools.length} static tools`)
    }

    /**
     * Load MCP tools from the MCP tool provider
     * @private
     */
    private async loadMcpTools(): Promise<Tool[]> {
        if (!this.mcpToolProvider) {
            getLogger().info('ToolManager: No MCP tool provider available')
            return []
        }
        
        try {
            getLogger().info('ToolManager: Fetching MCP servers from provider')
            const mcpServers = this.mcpToolProvider.getServers()
            getLogger().info(`ToolManager: Found ${mcpServers.length} MCP servers`)
            
            const mcpTools: Tool[] = []
            
            for (const server of mcpServers) {
                getLogger().info(`ToolManager: Processing server: ${server.name || 'unnamed'}`)
                
                if (!server.tools || !Array.isArray(server.tools)) {
                    getLogger().info(`ToolManager: Server ${server.name || 'unnamed'} has no valid tools property`)
                    continue
                }
                
                getLogger().info(`ToolManager: Server ${server.name || 'unnamed'} has ${server.tools.length} tools`)
                
                for (const tool of server.tools) {
                    if (tool.name) {
                        const toolName = `mcp_${server.name}___${tool.name}`.replace(/-/, '_')
                        getLogger().info(`ToolManager: Adding MCP tool: ${toolName}`)
                        
                        mcpTools.push({
                            toolSpecification: {
                                name: toolName,
                                description: tool.description || `MCP tool ${tool.name} from server ${server.name}`,
                                inputSchema: { json: tool.inputSchema || {} },
                            },
                        })
                    } else {
                        getLogger().info(`ToolManager: Skipping tool without name in server ${server.name || 'unnamed'}`)
                    }
                }
            }
            
            return mcpTools
        } catch (error) {
            getLogger().error(`ToolManager: Failed to get MCP tools: ${error}`)
            return []
        }
    }

    /**
     * Update the no-write tools cache based on current tools
     * @private
     */
    private updateNoWriteTools(): void {
        this.cachedNoWriteTools = this.cachedTools.filter(tool => {
            const toolName = tool.toolSpecification?.name || ''
            
            // If it's an MCP tool, include it (we assume MCP tools are safe by default)
            if (toolName.startsWith('mcp_')) {
                return true
            }
            
            // Filter out known write tools
            return !['fsWrite', 'executeBash'].includes(toolName)
        })
        
        getLogger().info(`ToolManager: Updated no-write tools cache (${this.cachedNoWriteTools.length} tools)`)
    }
}
