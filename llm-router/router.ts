/**
 * Минимальный LLM-роутер с fallback — companion-код к статье
 * «Пять LLM-провайдеров через один openai-клиент».
 *
 * Упрощённый extract боевого AiService из стека wiin.agency: без БД, фреймворка,
 * промптов и секретов. Все провайдеры — через один клиент `openai`, отличается baseURL.
 *
 * https://wiin.agency
 */
import OpenAI from 'openai';

export type Strategy = 'QUALITY' | 'BALANCED' | 'FAST';

export interface ProviderConfig {
  client: OpenAI;
  model: string;
  name: string;
}

export interface ChatOptions {
  system: string;
  user: string;
  strategy?: Strategy;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}

export interface ChatResult {
  content: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  durationMs: number;
}

/** Прайс за 1M токенов (вход/выход), USD — примерные значения, замените на актуальные. */
const PRICING: Record<string, { in: number; out: number }> = {
  groq: { in: 0.15, out: 0.6 },
  mistral: { in: 0.4, out: 2 },
  openai: { in: 0.15, out: 0.6 },
  deepseek: { in: 0.27, out: 1.1 },
  xai: { in: 0.3, out: 0.5 },
};

const clientFor = (key: string | undefined, baseURL: string): OpenAI | null =>
  key ? new OpenAI({ apiKey: key, baseURL }) : null;

export class LlmRouter {
  private readonly chains: Record<Strategy, ProviderConfig[]>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    // Один SDK, разные baseURL. Клиент создаётся только при наличии ключа.
    const groq = clientFor(env.AI_GROQ_API_KEY, 'https://api.groq.com/openai/v1');
    const mistral = clientFor(env.AI_MISTRAL_API_KEY, 'https://api.mistral.ai/v1');
    const openai = clientFor(env.AI_OPENAI_API_KEY, 'https://api.openai.com/v1');
    const deepseek = clientFor(env.AI_DEEPSEEK_API_KEY, 'https://api.deepseek.com');
    const xai = clientFor(env.AI_XAI_API_KEY, 'https://api.x.ai/v1');

    const p = (c: OpenAI | null, model: string, name: string): ProviderConfig | null =>
      c ? { client: c, model, name } : null;

    // Groq — один клиент, разные модели под роли.
    const groqQuality = p(groq, 'openai/gpt-oss-120b', 'groq');
    const groqLarge = p(groq, 'llama-3.3-70b-versatile', 'groq');
    const groqStructured = p(groq, 'qwen/qwen3-32b', 'groq');
    const groqFast = p(groq, 'llama-3.1-8b-instant', 'groq');
    const mistralMedium = p(mistral, 'mistral-medium-latest', 'mistral');
    const mistralSmall = p(mistral, 'mistral-small-latest', 'mistral');
    const oai = p(openai, env.AI_OPENAI_MODEL ?? 'gpt-5-nano', 'openai');
    const ds = p(deepseek, 'deepseek-chat', 'deepseek');
    const grok = p(xai, 'grok-3-mini', 'xai');

    const f = (...xs: (ProviderConfig | null)[]) => xs.filter(Boolean) as ProviderConfig[];

    // Неконфигурированные провайдеры просто выпадают из цепочек (graceful degradation).
    this.chains = {
      QUALITY: f(groqQuality, groqLarge, mistralMedium, oai, ds, grok),
      BALANCED: f(groqLarge, groqStructured, mistralMedium, groqQuality, oai, grok),
      FAST: f(groqFast, groqStructured, mistralSmall, oai),
    };
  }

  /** Прогон по цепочке: retry первого провайдера, затем fallback к следующим. */
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const strategy = opts.strategy ?? 'QUALITY';
    const chain = this.chains[strategy];
    if (chain.length === 0) throw new Error(`No provider configured for strategy "${strategy}"`);

    let lastError: Error | undefined;
    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i]!;
      try {
        const res = await this.call(provider, opts);
        if (i > 0) console.warn(`AI fallback → ${provider.name} (${provider.model})`);
        return res;
      } catch (err) {
        lastError = err as Error;
        console.warn(`AI ${provider.name} failed: ${lastError.message}`);
        if (i === 0) {
          // ретраим только первого провайдера, один раз
          await new Promise((r) => setTimeout(r, 2000));
          try {
            return await this.call(provider, opts);
          } catch (retryErr) {
            lastError = retryErr as Error;
          }
        }
      }
    }
    throw lastError ?? new Error('No AI provider available');
  }

  private async call(provider: ProviderConfig, opts: ChatOptions): Promise<ChatResult> {
    const m = provider.model;
    // reasoning-модели: max_completion_tokens + reasoning_effort вместо max_tokens + temperature
    const isReasoning = m.startsWith('gpt-5') || m.startsWith('openai/gpt-oss');
    const params: Record<string, unknown> = {
      model: m,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    };
    if (isReasoning) {
      params.max_completion_tokens = (opts.maxTokens ?? 2048) * 2;
      params.reasoning_effort = 'low';
    } else {
      params.temperature = opts.temperature ?? 0.5;
      params.max_tokens = opts.maxTokens ?? 2048;
    }
    if (opts.jsonMode) params.response_format = { type: 'json_object' };

    const t0 = Date.now();
    const res = await provider.client.chat.completions.create(params as never);
    const raw = (res as OpenAI.ChatCompletion).choices[0]?.message?.content ?? '';
    // вырезаем <think>...</think> reasoning-моделей
    const content = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // пустой ответ — это ошибка, уходим к следующему провайдеру
    if (!content) throw new Error(`empty content from ${provider.name}`);

    const usage = (res as OpenAI.ChatCompletion).usage;
    const tokensIn = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const pr = PRICING[provider.name] ?? PRICING.openai!;
    const costUsd = (tokensIn / 1e6) * pr.in + (tokensOut / 1e6) * pr.out;

    return {
      content,
      provider: provider.name,
      model: m,
      tokensIn,
      tokensOut,
      costCents: Math.round(costUsd * 100),
      durationMs: Date.now() - t0,
    };
  }
}
