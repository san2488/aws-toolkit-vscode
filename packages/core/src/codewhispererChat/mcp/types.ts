/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Default timeout for MCP operations in seconds
export const DEFAULT_MCP_TIMEOUT_SECONDS = 30
export const MIN_MCP_TIMEOUT_SECONDS = 5

// MCP server connection status
export type McpServerStatus = "connected" | "connecting" | "disconnected"

// MCP mode
export type McpMode = "full" | "basic" | "off"

// MCP tool definition
export interface McpTool {
    name: string
    description?: string
    inputSchema?: any
    autoApprove?: boolean
}

// MCP server definition
export interface McpServer {
    name: string
    config: string
    status: McpServerStatus
    disabled?: boolean
    error?: string
    tools?: McpTool[]
}

// MCP tool call response
export interface McpToolCallResponse {
    content: Array<{
        type: string
        text?: string
        mimeType?: string
        resource?: {
            uri: string
        }
    }>
    isError?: boolean
}

// Helper function to convert seconds to milliseconds
export function secondsToMs(seconds: number): number {
    return seconds * 1000
}
