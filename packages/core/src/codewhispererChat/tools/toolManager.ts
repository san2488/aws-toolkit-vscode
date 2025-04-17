/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool } from '@amzn/codewhisperer-streaming'
import toolsJson from './tool_index.json'
import { getLogger } from '../../shared/logger/logger'
import { McpToolCallResponse, McpToolProvider, MCP_TOOL_NAME_PREFIX } from '../mcp/types'

/**
 * Manages tools from both local definitions and MCP servers
 */
export class ToolManager {
    private static instance: ToolManager
    private mcpToolProvider?: McpToolProvider
    private nativeTools: Tool[] = []
    private mcpTools: Tool[] = []
    private lastCacheTime: number = 0
    private readonly CACHE_TTL_MS = 3000 // 30 seconds cache TTL

    /**
     * Constructor initializes both static and MCP tools
     */
    private constructor() {
        // Load static tools immediately
        this.loadStaticTools()

        getLogger().info(`ToolManager: Initialized with ${this.getToolsSync().length} static tools`)
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
    public setMcpToolProvider(mcpToolProvider: McpToolProvider): void {
        this.mcpToolProvider = mcpToolProvider

        // Load MCP tools immediately when provider is set
        this.loadMcpTools()
    }

    private async reloadAllTools() {
        this.loadStaticTools()

        // Reload MCP tools if provider is available
        if (this.mcpToolProvider) {
            this.loadMcpTools()
        } else {
            this.mcpTools = []
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
            return this.getToolsSync()
        }

        // Reload all tools
        await this.reloadAllTools()

        this.lastCacheTime = now
        return this.getToolsSync()
    }

    /**
     * Get tools that don't modify files (no write tools)
     * @returns Array of tools that don't modify files
     */
    public async getNoWriteTools(forceRefresh: boolean = false): Promise<Tool[]> {
        // Ensure tools are up to date
        return this.getTools(forceRefresh).then((tools) => tools.filter((tool) => this.isNoWriteTool(tool)))
    }

    /**
     * Get all available tools synchronously
     * @returns Array of tools
     */
    public getToolsSync(): Tool[] {
        return [...this.nativeTools, ...this.mcpTools]
    }

    /**
     * Get all available tools excluding write tools synchronously
     * @returns Array of tools excluding write tools
     */
    public getNoWriteToolsSync(): Tool[] {
        return this.getToolsSync().filter((tool) => !this.isNoWriteTool(tool))
    }

    /**
     * Check if a tool is an MCP tool
     * @param tool The name of the tool
     * @returns Whether the tool is an MCP tool
     */
    public isMcpTool(tool: string | Tool): boolean {
        if (typeof tool === 'object') {
            return tool.toolSpecification?.name?.startsWith(MCP_TOOL_NAME_PREFIX) ?? false
        }
        return tool.startsWith(MCP_TOOL_NAME_PREFIX)
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

        // if all native tools are not static, then this must change
        this.nativeTools = Object.entries(toolsJson).map(([, toolSpec]) => ({
            toolSpecification: {
                ...toolSpec,
                inputSchema: { json: toolSpec.inputSchema },
            },
        }))

        getLogger().info(`ToolManager: Loaded ${this.nativeTools.length} static tools`)
    }

    /**
     * Load MCP tools from the MCP tool provider
     */
    private async loadMcpTools() {
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
                // Agent seems to ignore if we have too many tools. Limiting each server to 10 tools
                const MAX_TOOLS = 10
                let onboardedToolCount = 0
                for (const tool of server.tools) {
                    if (onboardedToolCount > MAX_TOOLS) {
                        continue
                    }
                    onboardedToolCount += 1
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
                        getLogger().info(
                            `ToolManager: Skipping tool without name in server ${server.name || 'unnamed'}`
                        )
                    }
                }
            }

            this.mcpTools = mcpTools
        } catch (error) {
            getLogger().error(`ToolManager: Failed to get MCP tools: ${error}`)
        }
    }

    private isNoWriteTool(tool: string | Tool) {
        const toolName = typeof tool === 'string' ? tool : tool.toolSpecification?.name || ''
        if (this.isMcpTool(toolName)) {
            // TODO: revisit how MCP tools should be marked writable
            return true
        }
        return ['fsWrite', 'executeBash'].includes(toolName)
    }
}
