/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpHub } from './McpHub'

export class McpHandler {
    private mcpHub: McpHub

    constructor(mcpHub: McpHub) {
        this.mcpHub = mcpHub
    }

    /**
     * Parses a message for MCP tool calls
     * @param message The message to parse
     * @returns The tool call details if found, null otherwise
     */
    parseMcpToolCall(message: string): { serverName: string; toolName: string; args: any } | null {
        const mcpToolRegex =
            /<use_mcp_tool>\s*<server_name>(.*?)<\/server_name>\s*<tool_name>(.*?)<\/tool_name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/use_mcp_tool>/i
        const match = message.match(mcpToolRegex)

        if (match) {
            const [, serverName, toolName, argsStr] = match
            try {
                const args = JSON.parse(argsStr.trim())
                return { serverName, toolName, args }
            } catch (e) {
                console.error('Failed to parse MCP tool arguments:', e)
            }
        }

        return null
    }

    /**
     * Handles an MCP tool call
     * @param serverName The name of the server
     * @param toolName The name of the tool
     * @param args The arguments for the tool
     * @returns The formatted response from the tool
     */
    async handleMcpToolCall(serverName: string, toolName: string, args: any): Promise<string> {
        try {
            const result = await this.mcpHub.callTool(serverName, toolName, args)

            // Format the response
            const formattedResponse =
                (result?.isError ? 'Error:\n' : '') +
                    result?.content
                        .map((item) => {
                            if (item.type === 'text') {
                                return item.text
                            }
                            return ''
                        })
                        .filter(Boolean)
                        .join('\n\n') || '(No response)'

            return formattedResponse
        } catch (error) {
            return `Error executing MCP tool: ${error instanceof Error ? error.message : String(error)}`
        }
    }

    /**
     * Processes a message for MCP tool calls
     * @param message The message to process
     * @returns The processed message with MCP responses, or null if no MCP calls were found
     */
    async processMessage(message: string): Promise<string | null> {
        // Check for MCP tool calls
        const mcpToolCall = this.parseMcpToolCall(message)
        if (mcpToolCall) {
            const { serverName, toolName, args } = mcpToolCall
            const response = await this.handleMcpToolCall(serverName, toolName, args)
            return response
        }

        // No MCP calls found
        return null
    }

    /**
     * Generates MCP system prompt content
     * @returns The MCP system prompt content
     */
    generateMcpSystemPrompt(): string {
        if (this.mcpHub.getMode() === 'off') {
            return ''
        }

        let mcpPrompt = `
## MCP Tools

You have access to additional tools through the Model Context Protocol (MCP):

### use_mcp_tool
Description: Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities.
Parameters:
- server_name: (required) The name of the MCP server providing the tool
- tool_name: (required) The name of the tool to execute
- arguments: (required) A JSON object containing the tool's input parameters, following the tool's input schema
Usage:
<use_mcp_tool>
<server_name>server name here</server_name>
<tool_name>tool name here</tool_name>
<arguments>
{
  "param1": "value1",
  "param2": "value2"
}
</arguments>
</use_mcp_tool>
`

        // Add connected servers information
        const servers = this.mcpHub.getServers()
        if (servers.length > 0) {
            mcpPrompt += `\n## Connected MCP Servers\n`

            for (const server of servers.filter((s) => s.status === 'connected')) {
                const config = JSON.parse(server.config)
                mcpPrompt += `\n### ${server.name}`

                if (config.command) {
                    mcpPrompt += ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(' ')}` : ''}\`)`
                }

                if (server.tools && server.tools.length > 0) {
                    mcpPrompt += `\n\n#### Available Tools\n`
                    for (const tool of server.tools) {
                        mcpPrompt += `- ${tool.name}: ${tool.description || 'No description'}\n`
                        if (tool.inputSchema) {
                            mcpPrompt += `    Input Schema:\n    ${JSON.stringify(tool.inputSchema, null, 2).split('\n').join('\n    ')}\n`
                        }
                    }
                }
            }
        } else {
            mcpPrompt += '\n(No MCP servers currently connected)\n'
        }

        // Add server creation instructions if in full mode
        if (this.mcpHub.getMode() === 'full') {
            mcpPrompt += `
## Creating an MCP Server

To create a new MCP server:

1. Create a JSON configuration file at ~/.aws/amazonq/mcp.json
2. Add your server configuration to the mcpServers object
3. Restart VS Code to apply the changes

Example MCP settings file:
\`\`\`json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "API_KEY": "your-api-key"
      },
      "autoApprove": ["safe-tool-name"],
      "disabled": false
    }
  }
}
\`\`\`
`
        }

        return mcpPrompt
    }
}
