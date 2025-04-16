import { McpToolExecutor } from "./mcpToolExecutor";
import { Writable } from 'stream'
import { InvokeOutput, OutputKind } from './toolShared'
import { McpToolCallResponse } from "../mcp";

export interface McpToolParams {
    readonly toolName: string
    readonly args: any
}

export class InvocableMcpTool {
    readonly name: string
    constructor(private readonly mcpToolParams: McpToolParams) {
        this.name = mcpToolParams.toolName
    }
    public async invoke(updates?: Writable): Promise<InvokeOutput> {
        try {
            const response: McpToolCallResponse = await McpToolExecutor.execute(this.mcpToolParams.toolName, this.mcpToolParams.args)
            return {
                output: {
                    kind: OutputKind.Text, // todo: verify type
                    content: response.content[0].text,
                    success: true
                }
            }
        } catch (error: any) {
            return {
                output: {
                    kind: OutputKind.Text,
                    content: error.message,
                    success: false
                }
            }
        }
    }

    public async validate(): Promise<void> {
    }


    public queueDescription(updates: Writable): void {
        updates.write('```mcp\n' + JSON.stringify(this.mcpToolParams.args) + '\n```')
        updates.end()
    }
}