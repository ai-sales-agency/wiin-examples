import { LlmRouter } from './router';

// Задай ключ хотя бы одного провайдера в окружении, например:
//   export AI_GROQ_API_KEY=...
// и запусти:  npm i && npm start
const router = new LlmRouter();

const res = await router.chat({
  system: 'Ты — лаконичный технический ассистент. Отвечай одним предложением.',
  user: 'Зачем нужен fallback между несколькими LLM-провайдерами?',
  strategy: 'FAST',
});

console.log(res.content);
console.log(
  `\n[${res.provider}/${res.model}] ${res.tokensIn}+${res.tokensOut} tok · ~${res.costCents}¢ · ${res.durationMs}ms`,
);
