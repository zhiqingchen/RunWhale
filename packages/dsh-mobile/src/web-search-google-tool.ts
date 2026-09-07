import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatSearchOutput, presentSearchCall, presentSearchResult } from '@deepseek-ai/dsh-tool-web'
import type { GoogleSearchResult } from './web-search-mobile.js'

/** Google's required search widget must survive tool-result persistence outside model context. */
export function registerGoogleSearchTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'web_search',
    description: 'Search current information with Google Search. Supply exactly one query per call; cite the returned sources.',
    parameters: { queries: { type: 'array', required: true, items: { type: 'string' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        content: { type: 'string' }, searchSuggestions: { type: 'string' },
        sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' },
        } } }, truncated: { type: 'boolean', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => ({ sources: value.sources, truncated: value.truncated,
        ...(value.content !== undefined ? { answer: value.content } : {}),
        ...(value.searchSuggestions !== undefined ? { googleSearchSuggestions: value.searchSuggestions } : {}),
      }),
    },
    timeoutMs: 180000, isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.queries.length !== 1 || !args.queries[0]?.trim()) throw new Error('Supply exactly one non-empty search query.')
      const result = await ctx.web.search({ query: args.queries[0] }, exec.signal) as GoogleSearchResult
      return { ...result, sources: result.sources.map((item) => ({ ...item })) }
    },
    presentCall: presentSearchCall, presentResult: presentSearchResult,
  }))
}
