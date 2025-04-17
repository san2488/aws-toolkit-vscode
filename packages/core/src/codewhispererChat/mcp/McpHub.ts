import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { z } from 'zod'
import { McpServer, McpTool, McpToolCallResponse, McpToolProvider } from './types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { ToolManager } from '../tools/toolManager'

export type McpConnection = {
    server: McpServer
    client?: Client
    transport?: StdioClientTransport | SSEClientTransport
}

export type McpTransportType = 'stdio' | 'sse'

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
    transportType: 'sse' as const,
}))

const StdioConfigSchema = BaseConfigSchema.extend({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
}).transform((config) => ({
    ...config,
    transportType: 'stdio' as const,
}))

const ServerConfigSchema = z.union([StdioConfigSchema, SseConfigSchema])

const McpSettingsSchema = z.object({
    mcpServers: z.record(ServerConfigSchema),
})

export class McpHub implements McpToolProvider {
    private disposables: vscode.Disposable[] = []
    private callableServerNames: { [key: string]: string } = {}
    private connections: McpConnection[] = []
    isConnecting: boolean = false

    constructor(clientVersion: string) {
        this.watchMcpSettingsFile()
        this.initializeMcpServers()
    }

    getServers(): McpServer[] {
        // Only return enabled servers
        return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
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
                await fs.writeFile(defaultPath, JSON.stringify({ mcpServers: {} }, null, 2))
            } catch (err) {
                console.error('Failed to create default MCP settings file:', err)
            }
            return defaultPath
        }
    }

    private async readAndValidateMcpSettingsFile(): Promise<z.infer<typeof McpSettingsSchema> | undefined> {
        try {
            const settingsPath = await this.getMcpSettingsFilePath()
            const content = await fs.readFile(settingsPath, 'utf-8')

            let config: any

            // Parse JSON file content
            try {
                config = JSON.parse(content)
            } catch (error) {
                vscode.window.showErrorMessage(
                    'Invalid MCP settings format. Please ensure your settings follow the correct JSON format.'
                )
                return undefined
            }

            // Validate against schema
            const result = McpSettingsSchema.safeParse(config)
            if (!result.success) {
                vscode.window.showErrorMessage('Invalid MCP settings schema.')
                return undefined
            }

            return result.data
        } catch (error) {
            console.error('Failed to read MCP settings:', error)
            return undefined
        }
    }

    private async initializeMcpServers(): Promise<void> {
        const settings = await this.readAndValidateMcpSettingsFile()
        if (settings) {
            await this.updateServerConnections(settings.mcpServers).then(() => {
                const toolManager = ToolManager.getInstance()
                toolManager.setMcpToolProvider(this)
            })
        }
    }

    private async connectToServer(name: string, config: McpServerConfig): Promise<void> {
        // Remove existing connection if it exists
        this.connections = this.connections.filter((conn) => conn.server.name !== name)
        this.callableServerNames[name.replace(/-/g, '_')] = name

        try {
            // Create a client for the MCP server
            const client = new Client(
                {
                    name: 'AWS-Toolkit-VSCode',
                    version: '1.0.0', // Should use actual version
                },
                {
                    capabilities: {},
                }
            )

            let transport: StdioClientTransport | SSEClientTransport

            if (config.transportType === 'sse') {
                transport = new SSEClientTransport(new URL(config.url), {})
            } else {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args,
                    env: {
                        ...config.env,
                        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
                    },
                    stderr: 'pipe', // necessary for stderr to be available
                })
            }

            transport.onerror = async (error) => {
                console.error(`Transport error for "${name}":`, error)
                const connection = this.connections.find((conn) => conn.server.name === name)
                if (connection) {
                    connection.server.status = 'disconnected'
                    this.appendErrorMessage(connection, error.message)
                }
            }

            transport.onclose = async () => {
                const connection = this.connections.find((conn) => conn.server.name === name)
                if (connection) {
                    connection.server.status = 'disconnected'
                }
            }

            const connection: McpConnection = {
                server: {
                    name,
                    config: JSON.stringify(config),
                    status: 'connecting',
                    disabled: config.disabled,
                    tools: [],
                },
                client,
                transport,
            }

            this.connections.push(connection)

            if (config.transportType === 'stdio') {
                await transport.start()
                const stderrStream = (transport as StdioClientTransport).stderr
                if (stderrStream) {
                    stderrStream.on('data', async (data: Buffer) => {
                        const output = data.toString()
                        // Check if output contains INFO level log
                        const isInfoLog = /^\s*INFO\b/.test(output)

                        if (isInfoLog) {
                            // Log normal informational messages
                            console.info(`Server "${name}" info:`, output)
                        } else {
                            // Treat as error log
                            console.error(`Server "${name}" stderr:`, output)
                            const connection = this.connections.find((conn) => conn.server.name === name)
                            if (connection) {
                                this.appendErrorMessage(connection, output)
                            }
                        }
                    })
                }
                transport.start = async () => {} // No-op now, .connect() won't fail
            }

            // Connect
            await client.connect(transport)

            connection.server.status = 'connected'
            connection.server.error = ''

            // Fetch tools
            connection.server.tools = await this.fetchToolsList(name)
        } catch (error) {
            // Update status with error
            const connection = this.connections.find((conn) => conn.server.name === name)
            if (connection) {
                connection.server.status = 'disconnected'
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

            if (!connection.client) {
                throw new Error(`MCP client not initialized for server: ${serverName}`)
            }

            const response = await connection.client.request({ method: 'tools/list' }, ListToolsResultSchema, {
                timeout: 5000,
            })

            // Get autoApprove settings from the configuration file
            const settingsPath = await this.getMcpSettingsFilePath()
            const content = await fs.readFile(settingsPath, 'utf-8')
            const config = JSON.parse(content)
            const autoApproveConfig = config.mcpServers[serverName]?.autoApprove || []

            // Mark tools as always allowed based on settings
            const tools = (response?.tools || []).map((tool) => ({
                ...tool,
                autoApprove: autoApproveConfig.includes(tool.name),
            }))

            console.log(`Fetched ${tools.length} tools from server ${serverName}`)
            return tools
        } catch (error) {
            console.error(`Failed to fetch tools for ${serverName}:`, error)
            return []
        }
    }

    async deleteConnection(name: string): Promise<void> {
        const connection = this.connections.find((conn) => conn.server.name === name)
        if (connection) {
            try {
                if (connection.transport) {
                    await connection.transport.close()
                }
                if (connection.client) {
                    await connection.client.close()
                }
            } catch (error) {
                console.error(`Failed to close transport for ${name}:`, error)
            }
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
            connection.server.status = 'connecting'
            connection.server.error = ''

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

    async readResource(serverName: string, uri: string): Promise<any> {
        throw new Error('Resources are not supported')
    }

    async callTool(
        serverName: string,
        toolName: string,
        toolArguments?: Record<string, unknown>
    ): Promise<McpToolCallResponse> {
        const callableServerName: string = this.callableServerNames[serverName]
        const connection = this.connections.find((conn) => conn.server.name === callableServerName)
        if (!connection) {
            throw new Error(
                `No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`
            )
        }

        if (connection.server.disabled) {
            throw new Error(`Server "${serverName}" is disabled and cannot be used`)
        }

        if (!connection.client) {
            throw new Error(`MCP client not initialized for server: ${serverName}`)
        }

        // Set default timeout
        let timeout = 60000 // Default 30 seconds in milliseconds

        try {
            // Try to get custom timeout from server config
            const config = JSON.parse(connection.server.config)
            if (config.timeout) {
                // Convert seconds to milliseconds
                timeout = config.timeout * 1000
            }
        } catch (error) {
            console.error(`Failed to parse timeout configuration for server ${serverName}:`, error)
        }

        return await connection.client.request(
            {
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: toolArguments,
                },
            },
            CallToolResultSchema,
            {
                timeout,
            }
        )
    }

    dispose(): void {
        // Clean up connections and watchers
        for (const connection of this.connections) {
            this.deleteConnection(connection.server.name).catch((error) => {
                console.error(`Failed to close connection for ${connection.server.name}:`, error)
            })
        }

        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }
}
