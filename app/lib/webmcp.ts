'use client';
import { useEffect } from 'react';
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type Context = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };

/** Feature-detected browser tools read the same scoped data as the visible workspace. */
export function useWorkspaceTool(tool: Tool) {
  useEffect(() => {
    /* Register only when the browser supports WebMCP and unregister with component lifetime. */

    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const lifetime = new AbortController();
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifetime.signal })).catch(() => {});
    } catch {
      /* Browsers without this optional API retain all ordinary UI actions. */
    }
    return () => lifetime.abort();
  }, [tool]);
}
