import { Writable } from 'stream'
import { InvokeOutput, OutputKind } from './toolShared'
import { McpToolCallResponse } from '../mcp'
import { InvokeInput as InvokeMcpParams } from '../mcp/types'
import { ToolkitError, getLogger } from '../../shared'
import { ToolManager } from './toolManager'

export class InvocableMcpTool {
    readonly name: string
    constructor(private readonly mcpToolParams: InvokeMcpParams) {
        this.name = mcpToolParams.toolName
    }
    public async invoke(updates?: Writable): Promise<InvokeOutput> {
        try {
            const response: McpToolCallResponse = await this.execute(
                this.mcpToolParams.toolName,
                this.mcpToolParams.args
            )
            const formattedResponse = this.formatResponse(response)
            return {
                output: {
                    kind: OutputKind.Text, // todo: verify type
                    content: formattedResponse,
                    success: true,
                },
            }
        } catch (error: any) {
            return {
                output: {
                    kind: OutputKind.Text,
                    content: error.message,
                    success: false,
                },
            }
        }
    }

    private formatResponse(response: McpToolCallResponse) {
        return (
            (response?.isError ? 'Error:\n' : '') +
                response?.content
                    .map((item) => {
                        if (item.type === 'text') {
                            return item.text
                        }
                        return ''
                    })
                    .filter(Boolean)
                    .join('\n\n') || '(No response)'
        )
    }

    public async validate(): Promise<void> {}

    public queueDescription(updates: Writable): void {
        updates.write(
            'Running tool `' + this.name + '` with params `(' + JSON.stringify(this.mcpToolParams.args) + ')`'
        )
        updates.end()
    }

    private async execute(toolName: string, args: any): Promise<McpToolCallResponse> {
        const toolManager = ToolManager.getInstance()

        if (!toolManager.isMcpTool(toolName)) {
            throw new ToolkitError(`Not an MCP tool: ${toolName}`)
        }

        getLogger().info(`Executing MCP tool: ${toolName} with args: ${JSON.stringify(args)}`)
        return await toolManager.executeMcpTool(toolName, args)
    }
}
