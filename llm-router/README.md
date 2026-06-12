# LLM-роутер с fallback

Companion-код к статье **[«Пять LLM-провайдеров через один openai-клиент»](https://habr.com/ru/articles/1046902/)** на Habr.

Что показывает:
- пять провайдеров (Groq, Mistral, OpenAI, DeepSeek, xAI) через **один** клиент `openai` — отличается только `baseURL`;
- стратегии-цепочки (`QUALITY` / `BALANCED` / `FAST`) — упорядоченный список «провайдер + модель» под класс задачи;
- fallback по цепочке + retry первого провайдера;
- нюанс reasoning-моделей (`max_completion_tokens` + `reasoning_effort`), вырезание `<think>…</think>`;
- пустой ответ модели трактуется как ошибка;
- учёт стоимости вызова.

Это упрощённый, самодостаточный extract нашего боевого `AiService` — без БД, фреймворка, промптов и секретов.

## Запуск

```bash
npm i
export AI_GROQ_API_KEY=...   # достаточно ключа хотя бы одного провайдера
npm start
```

Файлы: [`router.ts`](./router.ts) — сам роутер · [`example.ts`](./example.ts) — пример вызова.

—
Часть стека [wiin.agency](https://wiin.agency): внедряем ИИ-агентов в отделы продаж. [Блог](https://wiin.agency/blog).
