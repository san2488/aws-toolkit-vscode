/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { z } from "zod"
import {
    McpMode,
    McpResource,
    McpResourceResponse,
    McpResourceTemplate,
    McpServer,
    McpTool,
    McpToolCallResponse,
} from "./types"

export type McpConnection = {
    server: McpServer
}

export type McpTransportType = "stdio" | "sse"

export type McpServerConfig = z.infer<typeof ServerConfigSchema>

const AutoApproveSchema = z.array(z.string()).default([])

const BaseConfigSchema = z.object({
    autoApprove: AutoApproveSchema.optional(),
    disabled: z.boolean().optional(),
    timeout: z.number().optional(),
})

const SseConfigSchema = BaseConfigSchema.extend({
    url: z.string().url(),
}).transform((config) => ({
    ...config,
    transportType: "sse" as const,
}))

const StdioConfigSchema = BaseConfigSchema.extend({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
}).transform((config) => ({
    ...config,
    transportType: "stdio" as const,
}))

const ServerConfigSchema = z.union([StdioConfigSchema, SseConfigSchema])

const McpSettingsSchema = z.object({
    mcpServers: z.record(ServerConfigSchema),
})

export class McpHub {
    private disposables: vscode.Disposable[] = []
    connections: McpConnection[] = []
    isConnecting: boolean = false

    constructor(clientVersion: string) {
        this.watchMcpSettingsFile()
        this.initializeMcpServers()
    }

    getServers(): McpServer[] {
        // Only return enabled servers
        return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
    }

    getMode(): McpMode {
        return vscode.workspace.getConfiguration("amazonQ.mcp").get<McpMode>("mode", "full")
    }

    async getMcpSettingsFilePath(): Promise<string> {
        // First check for custom path in settings
        const customPath = vscode.workspace.getConfiguration('amazonQ.mcp').get<string>('settingsPath')
        if (customPath && customPath.trim() !== '') {
            return customPath
        }
        
        // Then check for ~/.aws/amazonq/mcp.json
        const defaultPath = path.join(os.homedir(), '.aws', 'amazonq', 'mcp.json')
        
        try {
            await fs.access(defaultPath)
            return defaultPath
        } catch {
            // If file doesn't exist, create it with empty structure
            try {
                await fs.mkdir(path.dirname(defaultPath), { recursive: true })
                await fs.writeFile(
                    defaultPath,
                    JSON.stringify({ mcpServers: {} }, null, 2)
                )
            } catch (err) {
                console.error('Failed to create default MCP settings file:', err)
            }
            return defaultPath
        }
    }

    private async readAndValidateMcpSettingsFile(): Promise<z.infer<typeof McpSettingsSchema> | undefined> {
        try {
            const settingsPath = await this.getMcpSettingsFilePath()
            const content = await fs.readFile(settingsPath, "utf-8")

            let config: any

            // Parse JSON file content
            try {
                config = JSON.parse(content)
            } catch (error) {
                vscode.window.showErrorMessage(
                    "Invalid MCP settings format. Please ensure your settings follow the correct JSON format."
                )
                return undefined
            }

            // Validate against schema
            const result = McpSettingsSchema.safeParse(config)
            if (!result.success) {
                vscode.window.showErrorMessage("Invalid MCP settings schema.")
                return undefined
            }

            return result.data
        } catch (error) {
            console.error("Failed to read MCP settings:", error)
            return undefined
        }
    }

    private async watchMcpSettingsFile(): Promise<void> {
        const settingsPath = await this.getMcpSettingsFilePath()
        
        // Create file watcher
        const fileWatcher = vscode.workspace.createFileSystemWatcher(settingsPath)
        
        // Watch for file changes
        fileWatcher.onDidChange(async () => {
            const settings = await this.readAndValidateMcpSettingsFile()
            if (settings) {
                try {
                    await this.updateServerConnections(settings.mcpServers)
                } catch (error) {
                    console.error("Failed to process MCP settings change:", error)
                }
            }
        })
        
        this.disposables.push(fileWatcher)
    }

    private async initializeMcpServers(): Promise<void> {
        const settings = await this.readAndValidateMcpSettingsFile()
        if (settings) {
            await this.updateServerConnections(settings.mcpServers)
        }
    }

    private async connectToServer(
        name: string,
        config: McpServerConfig
    ): Promise<void> {
        // Remove existing connection if it exists
        this.connections = this.connections.filter((conn) => conn.server.name !== name)

        try {
            // Create a mock server object for now
            const connection: McpConnection = {
                server: {
                    name,
                    config: JSON.stringify(config),
                    status: "connected",
                    disabled: config.disabled,
                    tools: [],
                    resources: [],
                    resourceTemplates: []
                }
            }
            
            this.connections.push(connection)
            
            // Fetch tools and resources
            connection.server.tools = await this.fetchToolsList(name)
            connection.server.resources = await this.fetchResourcesList(name)
            connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name)
        } catch (error) {
            // Update status with error
            const connection = this.connections.find((conn) => conn.server.name === name)
            if (connection) {
                connection.server.status = "disconnected"
                this.appendErrorMessage(connection, error instanceof Error ? error.message : String(error))
            }
            throw error
        }
    }

    private appendErrorMessage(connection: McpConnection, error: string) {
        const newError = connection.server.error ? `${connection.server.error}\n${error}` : error
        connection.server.error = newError
    }

    private async fetchToolsList(serverName: string): Promise<McpTool[]> {
        try {
            const connection = this.connections.find((conn) => conn.server.name === serverName)

            if (!connection) {
                throw new Error(`No connection found for server: ${serverName}`)
            }

            // Get autoApprove settings from the configuration file
            const settingsPath = await this.getMcpSettingsFilePath()
            const content = await fs.readFile(settingsPath, "utf-8")
            const config = JSON.parse(content)
            const autoApproveConfig = config.mcpServers[serverName]?.autoApprove || []

            // For now, return a mock list of tools
            const mockTools = [
                {
                    name: "read_internal_website",
                    description: "Read content from internal Amazon websites",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "URL of the internal website to read"
                            }
                        },
                        required: ["url"]
                    },
                    autoApprove: autoApproveConfig.includes("read_internal_website")
                },
                {
                    name: "search_internal_code",
                    description: "Search across Amazon's internal code repositories",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "Search query for internal code"
                            }
                        },
                        required: ["query"]
                    },
                    autoApprove: autoApproveConfig.includes("search_internal_code")
                }
            ]

            console.log(`Fetched ${mockTools.length} tools from server ${serverName}`)
            return mockTools
        } catch (error) {
            console.error(`Failed to fetch tools for ${serverName}:`, error)
            return []
        }
    }

    private async fetchResourcesList(serverName: string): Promise<McpResource[]> {
        try {
            const connection = this.connections.find((conn) => conn.server.name === serverName)
            
            if (!connection) {
                throw new Error(`No connection found for server: ${serverName}`)
            }
            
            // For now, return a mock list of resources
            const mockResources = [
                {
                    uri: "wiki://amazon/ModelContextProtocol",
                    name: "MCP Documentation",
                    mimeType: "text/html",
                    description: "Documentation about the Model Context Protocol"
                }
            ]
            
            console.log(`Fetched ${mockResources.length} resources from server ${serverName}`)
            return mockResources
        } catch (error) {
            console.error(`Failed to fetch resources for ${serverName}:`, error)
            return []
        }
    }

    private async fetchResourceTemplatesList(serverName: string): Promise<McpResourceTemplate[]> {
        try {
            const connection = this.connections.find((conn) => conn.server.name === serverName)
            
            if (!connection) {
                throw new Error(`No connection found for server: ${serverName}`)
            }
            
            // For now, return a mock list of resource templates
            const mockTemplates = [
                {
                    uriTemplate: "wiki://amazon/{page}",
                    name: "Amazon Wiki Page",
                    description: "Access Amazon internal wiki pages",
                    mimeType: "text/html"
                }
            ]
            
            console.log(`Fetched ${mockTemplates.length} resource templates from server ${serverName}`)
            return mockTemplates
        } catch (error) {
            console.error(`Failed to fetch resource templates for ${serverName}:`, error)
            return []
        }
    }

    async deleteConnection(name: string): Promise<void> {
        const connection = this.connections.find((conn) => conn.server.name === name)
        if (connection) {
            this.connections = this.connections.filter((conn) => conn.server.name !== name)
        }
    }

    async updateServerConnections(newServers: Record<string, McpServerConfig>): Promise<void> {
        this.isConnecting = true
        const currentNames = new Set(this.connections.map((conn) => conn.server.name))
        const newNames = new Set(Object.keys(newServers))

        // Delete removed servers
        for (const name of currentNames) {
            if (!newNames.has(name)) {
                await this.deleteConnection(name)
                console.log(`Deleted MCP server: ${name}`)
            }
        }

        // Update or add servers
        for (const [name, config] of Object.entries(newServers)) {
            const currentConnection = this.connections.find((conn) => conn.server.name === name)

            if (!currentConnection) {
                // New server
                try {
                    await this.connectToServer(name, config)
                } catch (error) {
                    console.error(`Failed to connect to new MCP server ${name}:`, error)
                }
            } else if (JSON.stringify(JSON.parse(currentConnection.server.config)) !== JSON.stringify(config)) {
                // Existing server with changed config
                try {
                    await this.deleteConnection(name)
                    await this.connectToServer(name, config)
                    console.log(`Reconnected MCP server with updated config: ${name}`)
                } catch (error) {
                    console.error(`Failed to reconnect MCP server ${name}:`, error)
                }
            }
            // If server exists with same config, do nothing
        }
        this.isConnecting = false
    }

    async restartConnection(serverName: string): Promise<void> {
        this.isConnecting = true

        // Get existing connection and update its status
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        const config = connection?.server.config
        if (config) {
            connection.server.status = "connecting"
            connection.server.error = ""
            
            try {
                await this.deleteConnection(serverName)
                // Try to connect again using existing config
                await this.connectToServer(serverName, JSON.parse(config))
            } catch (error) {
                console.error(`Failed to restart connection for ${serverName}:`, error)
            }
        }

        this.isConnecting = false
    }

    // Public methods for tool and resource access
    
    async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        if (!connection) {
            throw new Error(`No connection found for server: ${serverName}`)
        }
        if (connection.server.disabled) {
            throw new Error(`Server "${serverName}" is disabled`)
        }

        // Mock response for now
        return {
            contents: [
                {
                    uri,
                    text: `Mock resource content for ${uri}`
                }
            ]
        }
    }

    async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<McpToolCallResponse> {
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        if (!connection) {
            throw new Error(
                `No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`
            )
        }

        if (connection.server.disabled) {
            throw new Error(`Server "${serverName}" is disabled and cannot be used`)
        }

        // Mock response for now
        return {
            content: [
                {
                    type: "text",
                    text: `Mock tool response for ${toolName} with arguments ${JSON.stringify(toolArguments)}`
                }
            ]
        }
    }

    dispose(): void {
        // Clean up connections and watchers
        for (const connection of this.connections) {
            this.deleteConnection(connection.server.name).catch(error => {
                console.error(`Failed to close connection for ${connection.server.name}:`, error)
            })
        }
        
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }
}
