import { McpToolExecutor } from './mcpToolExecutor'
import { Writable } from 'stream'
import { InvokeOutput, OutputKind } from './toolShared'
import { McpToolCallResponse } from '../mcp'

export interface McpToolParams {
    readonly toolName: string
    readonly args: any
}

/**
 * TODO: this class is not needed. use McpHub itself with it's `handleMcpToolCall` method
 */
export class InvocableMcpTool {
    readonly name: string
    constructor(private readonly mcpToolParams: McpToolParams) {
        this.name = mcpToolParams.toolName
    }
    public async invoke(updates?: Writable): Promise<InvokeOutput> {
        try {
            const response: McpToolCallResponse = await McpToolExecutor.execute(
                this.mcpToolParams.toolName,
                this.mcpToolParams.args
            )
            const formattedResponse =
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

    public async validate(): Promise<void> {}

    public queueDescription(updates: Writable): void {
        updates.write(
            'Running tool `' + this.name + '` with params `(' + JSON.stringify(this.mcpToolParams.args) + ')`'
        )
        updates.end()
    }
}
