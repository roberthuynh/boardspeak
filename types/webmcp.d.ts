export {};

declare global {
  interface WebMCPToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly inputSchema?: object;
    readonly annotations?: {
      readonly readOnlyHint?: boolean;
      readonly untrustedContentHint?: boolean;
    };
    readonly execute: (args: unknown) => unknown | Promise<unknown>;
  }

  interface WebMCPRegisteredTool extends WebMCPToolDefinition {
    readonly window?: Window;
    readonly origin?: string;
    readonly _execute?: (args: unknown) => unknown | Promise<unknown>;
  }

  interface WebMCPModelContext extends EventTarget {
    registerTool(
      tool: WebMCPToolDefinition,
      options?: { readonly signal?: AbortSignal },
    ): void | Promise<void>;
    getTools?(options?: { readonly fromOrigins?: readonly string[] }): Promise<
      WebMCPRegisteredTool[]
    >;
    executeTool?(
      tool: WebMCPRegisteredTool,
      args: unknown,
      options?: { readonly signal?: AbortSignal },
    ): Promise<unknown>;
  }

  interface Document {
    modelContext?: WebMCPModelContext;
  }

  interface Window {
    __webmcp_registered_tools?: Map<string, WebMCPRegisteredTool>;
    __boardspeak?: {
      getState: () => unknown;
      executeTool: (name: string, args?: unknown) => Promise<unknown>;
    };
  }
}
