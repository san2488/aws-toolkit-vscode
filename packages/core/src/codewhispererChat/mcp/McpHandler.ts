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
    parseMcpToolCall(message: string): { serverName: string, toolName: string, args: any } | null {
        const mcpToolRegex = /<use_mcp_tool>\s*<server_name>(.*?)<\/server_name>\s*<tool_name>(.*?)<\/tool_name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/use_mcp_tool>/i
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
     * Parses a message for MCP resource access
     * @param message The message to parse
     * @returns The resource access details if found, null otherwise
     */
    parseMcpResourceAccess(message: string): { serverName: string, uri: string } | null {
        const mcpResourceRegex = /<access_mcp_resource>\s*<server_name>(.*?)<\/server_name>\s*<uri>(.*?)<\/uri>\s*<\/access_mcp_resource>/i
        const match = message.match(mcpResourceRegex)
        
        if (match) {
            const [, serverName, uri] = match
            return { serverName, uri }
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
            const formattedResponse = result.content
                .map(item => {
                    if (item.type === 'text') {
                        return item.text
                    } else if (item.type === 'image') {
                        // Handle image response
                        return `[Image: ${item.mimeType}]`
                    } else if (item.type === 'resource' && item.resource) {
                        // Handle resource response
                        return `[Resource: ${item.resource.uri}]`
                    }
                    return ''
                })
                .filter(Boolean)
                .join('\n\n')
                
            return formattedResponse
        } catch (error) {
            return `Error executing MCP tool: ${error instanceof Error ? error.message : String(error)}`
        }
    }

    /**
     * Handles an MCP resource access
     * @param serverName The name of the server
     * @param uri The URI of the resource
     * @returns The formatted response from the resource
     */
    async handleMcpResourceAccess(serverName: string, uri: string): Promise<string> {
        try {
            const result = await this.mcpHub.readResource(serverName, uri)
            
            // Format the response
            const formattedResponse = result.contents
                .map(item => item.text || '')
                .filter(Boolean)
                .join('\n\n')
                
            return formattedResponse
        } catch (error) {
            return `Error accessing MCP resource: ${error instanceof Error ? error.message : String(error)}`
        }
    }

    /**
     * Processes a message for MCP tool calls or resource access
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
        
        // Check for MCP resource access
        const mcpResourceAccess = this.parseMcpResourceAccess(message)
        if (mcpResourceAccess) {
            const { serverName, uri } = mcpResourceAccess
            const response = await this.handleMcpResourceAccess(serverName, uri)
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
        if (this.mcpHub.getMode() === "off") {
            return "";
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

### access_mcp_resource
Description: Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context.
Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access
Usage:
<access_mcp_resource>
<server_name>server name here</server_name>
<uri>resource URI here</uri>
</access_mcp_resource>
`;

        // Add connected servers information
        const servers = this.mcpHub.getServers();
        if (servers.length > 0) {
            mcpPrompt += `\n## Connected MCP Servers\n`;
            
            for (const server of servers.filter(s => s.status === "connected")) {
                const config = JSON.parse(server.config);
                mcpPrompt += `\n### ${server.name}`;
                
                if (config.command) {
                    mcpPrompt += ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`;
                }
                
                if (server.tools && server.tools.length > 0) {
                    mcpPrompt += `\n\n#### Available Tools\n`;
                    for (const tool of server.tools) {
                        mcpPrompt += `- ${tool.name}: ${tool.description || 'No description'}\n`;
                        if (tool.inputSchema) {
                            mcpPrompt += `    Input Schema:\n    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}\n`;
                        }
                    }
                }
                
                if (server.resourceTemplates && server.resourceTemplates.length > 0) {
                    mcpPrompt += `\n#### Resource Templates\n`;
                    for (const template of server.resourceTemplates) {
                        mcpPrompt += `- ${template.uriTemplate} (${template.name}): ${template.description || 'No description'}\n`;
                    }
                }
                
                if (server.resources && server.resources.length > 0) {
                    mcpPrompt += `\n#### Direct Resources\n`;
                    for (const resource of server.resources) {
                        mcpPrompt += `- ${resource.uri} (${resource.name}): ${resource.description || 'No description'}\n`;
                    }
                }
            }
        } else {
            mcpPrompt += "\n(No MCP servers currently connected)\n";
        }

        // Add server creation instructions if in full mode
        if (this.mcpHub.getMode() === "full") {
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
`;
        }

        return mcpPrompt;
    }
}
