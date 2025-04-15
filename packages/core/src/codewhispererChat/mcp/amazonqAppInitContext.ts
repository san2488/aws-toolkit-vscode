/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extended AmazonQAppInitContext interface with MCP support
 */
export interface ExtendedAmazonQAppInitContext {
    /**
     * Register a message processor that will be called for each message
     * @param processor Function that processes messages and returns a response or null
     */
    registerMessageProcessor(processor: (message: string) => Promise<string | null>): void;
    
    /**
     * Register a system prompt provider that will be called when generating the system prompt
     * @param provider Function that returns additional content for the system prompt
     */
    registerSystemPromptProvider(provider: () => string): void;
}

/**
 * Extends the default AmazonQAppInitContext with MCP support
 * @param context The original context
 * @returns The extended context
 */
export function extendAmazonQAppInitContext(context: any): ExtendedAmazonQAppInitContext {
    const extendedContext = context as ExtendedAmazonQAppInitContext;
    
    // Add message processors array if it doesn't exist
    const messageProcessors: Array<(message: string) => Promise<string | null>> = [];
    
    // Add system prompt providers array if it doesn't exist
    const systemPromptProviders: Array<() => string> = [];
    
    // Add registerMessageProcessor method
    extendedContext.registerMessageProcessor = (processor: (message: string) => Promise<string | null>) => {
        messageProcessors.push(processor);
    };
    
    // Add registerSystemPromptProvider method
    extendedContext.registerSystemPromptProvider = (provider: () => string) => {
        systemPromptProviders.push(provider);
    };
    
    return extendedContext;
}
