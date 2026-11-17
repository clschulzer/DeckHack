import Anthropic from '@anthropic-ai/sdk';
import { applyEdit, cloneFiles } from '../core/edits';
import type { EditOp } from '../core/types';
import type { Provider, ReworkRequest, ReworkResult } from './provider';
import { SYSTEM_PROMPT, deckContext, taskText } from './prompt';



const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: 'replace_in_file',
    description: 'Replace one exact piece of text in a deck file. `old` must match the file exactly (including whitespace) and occur exactly once; include surrounding text to make it unique. Use this for every targeted change.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the deck root, for example index.html' },
        old: { type: 'string', description: 'Exact text to replace' },
        new: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old', 'new'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a text file, or replace a whole file when most of it changes. Text files only (html, css, js, json, svg).',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string', description: 'Complete file content' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the deck.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

const str = (v: unknown): v is string => typeof v === 'string';

/** Tool inputs are model output and arrive unvalidated when streamed eagerly, so check them here. */
function toEdit(name: string, input: unknown): EditOp | null {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === 'replace_in_file' && str(i.path) && str(i.old) && str(i.new)) return { op: 'replace', path: i.path, old: i.old, new: i.new };
  if (name === 'write_file' && str(i.path) && str(i.content)) return { op: 'write', path: i.path, content: i.content };
  if (name === 'delete_file' && str(i.path)) return { op: 'delete', path: i.path };
  return null;
}

function explain(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error('The API key was rejected. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('This API key may not use the selected model.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Rate limit reached. Wait a moment and apply again.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('Could not reach the Claude API. Check your connection, or whether this page is allowed to make network requests.');
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error ${err.status ?? ''}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Calls the Claude API straight from the browser with the user's own key.
 * There is no DeckHack server in between; the key goes to api.anthropic.com only.
 */
export const claudeProvider: Provider = {
  id: 'claude',
  label: 'Claude (your API key)',
  needsKey: true,

  async rework(request: ReworkRequest): Promise<ReworkResult> {
    const client = new Anthropic({ apiKey: request.apiKey, dangerouslyAllowBrowser: true });
    const files = cloneFiles(request.files);
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: deckContext(request), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: taskText(request) },
        ],
      },
    ];
    let summary = '';
    let jsonRetries = 0;

    for (let turn = 0; turn < 16; turn++) {
      const stream = client.beta.messages.stream(
        {
          model: request.model,
          max_tokens: 64000,
          // If a safety classifier declines, the API retries on a fallback model inside the same call.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          tools: TOOLS,
          messages,
        },
        { signal: request.signal },
      );
      let turnText = '';
      stream.on('text', (delta) => {
        turnText += delta;
        request.onEvent({ type: 'text', text: delta });
      });

      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // A tool input that could not be parsed rejects here; re-issue the turn a couple of times.
        if (err instanceof Anthropic.APIError || request.signal?.aborted || jsonRetries++ >= 2) throw explain(err);
        request.onEvent({ type: 'status', text: 'Retrying an interrupted reply' });
        continue;
      }

      if (message.stop_reason === 'refusal') throw new Error('The model declined this request. Rephrase the comment or pick another model in Settings.');
      if (message.stop_reason === 'max_tokens') throw new Error('The reply was cut off before the edits were complete. Apply fewer comments at once.');

      const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (!toolUses.length) {
        summary = turnText.trim();
        break;
      }

      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = toolUses.map((use) => {
        const edit = toEdit(use.name, use.input);
        if (!edit) {
          request.onEvent({ type: 'edit', ok: false, message: `Malformed ${use.name} call, asked the model to repeat it` });
          return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(use.input) }) };
        }
        const outcome = applyEdit(files, edit);
        request.onEvent({ type: 'edit', ok: outcome.ok, message: outcome.message });
        return { type: 'tool_result', tool_use_id: use.id, is_error: !outcome.ok, content: outcome.message };
      });
      messages.push({ role: 'user', content: results });
    }

    return { files, summary: summary || 'Changes applied.' };
  },
};
