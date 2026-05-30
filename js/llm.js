// llm.js — LLM provider abstraction for AI post generation
// API keys stored in localStorage (prefixed li_ai_)
// All calls go to local proxy at http://localhost:6655/*

export const PROVIDERS = {
  anthropic: {
    label:        'Anthropic (Claude)',
    base:         'http://localhost:6655/anthropic/v1',
    endpoint:     '/messages',
    models:       ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    label:        'OpenAI',
    base:         'http://localhost:6655/openai/v1',
    endpoint:     '/chat/completions',
    models:       ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o',
  },
  gemini: {
    label:        'Google Gemini',
    base:         'http://localhost:6655/gemini',
    endpoint:     '/v1beta/models/{model}:generateContent',
    models:       ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash',
  },
  litellm: {
    label:        'LiteLLM',
    base:         'http://localhost:6655/litellm/v1',
    endpoint:     '/chat/completions',
    models:       ['gpt-4o', 'claude-sonnet-4-6', 'gemini-2.0-flash'],
    defaultModel: 'gpt-4o',
  },
};

const LS = {
  PROVIDER: 'li_ai_provider',
  MODEL:    'li_ai_model',
  key:      p => `li_ai_key_${p}`,
};

// ── Config management ─────────────────────────────────────────

export function isConfigured() {
  const { provider, key } = getConfig();
  return !!(provider && key);
}

export function getConfig() {
  const provider = localStorage.getItem(LS.PROVIDER) || 'anthropic';
  const model    = localStorage.getItem(LS.MODEL) || PROVIDERS[provider]?.defaultModel || '';
  const key      = localStorage.getItem(LS.key(provider)) || '';
  return { provider, model, key };
}

export function getKeyForProvider(provider) {
  return localStorage.getItem(LS.key(provider)) || '';
}

export function saveConfig(provider, model, key) {
  localStorage.setItem(LS.PROVIDER, provider);
  localStorage.setItem(LS.MODEL,    model);
  if (key) localStorage.setItem(LS.key(provider), key);
}

export function getProviderList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label }));
}

export function getModelsForProvider(provider) {
  return PROVIDERS[provider]?.models || [];
}

// ── Post generation ───────────────────────────────────────────

/**
 * Generate a LinkedIn post using the configured LLM.
 * @param {object} opts
 * @param {string} opts.topic          — The subject to write about
 * @param {string} opts.category       — e.g. "Thought Leadership"
 * @param {string} opts.tone           — e.g. "Professional"
 * @param {string} [opts.prevContent]  — Previous generated content (for regeneration)
 * @param {string} [opts.feedback]     — User feedback for regeneration
 * @returns {Promise<string>}          — The generated post text
 */
export async function generatePost({ topic, category, tone, prevContent = '', feedback = '' }) {
  const { provider, model, key } = getConfig();
  if (!key) throw new Error('No API key configured. Click ✨ to set up AI.');

  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt({ topic, category, tone, prevContent, feedback });

  switch (provider) {
    case 'anthropic': return callAnthropic(model, key, systemPrompt, userPrompt);
    case 'openai':    return callOpenAI(model, key, systemPrompt, userPrompt);
    case 'gemini':    return callGemini(model, key, systemPrompt, userPrompt);
    case 'litellm':   return callLiteLLM(model, key, systemPrompt, userPrompt);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Prompt builders ───────────────────────────────────────────

function buildSystemPrompt() {
  return `You are an expert LinkedIn content creator. Your posts are engaging, authentic, and optimised for professional audiences.

Always follow these rules:
- Write ONLY the post content — no explanations, no "Here's your post:", no meta-commentary
- Maximum 3000 characters total
- Use short paragraphs and line breaks for readability
- End with 3-5 relevant hashtags on a new line
- Sound human and genuine, not like a template
- No markdown headers (##) or horizontal rules (---) unless they feel natural`;
}

function buildUserPrompt({ topic, category, tone, prevContent, feedback }) {
  if (prevContent && feedback) {
    return `Here is a LinkedIn post I generated:

${prevContent}

Please rewrite it based on this feedback: "${feedback}"
Keep the same category (${category}) and tone (${tone}).`;
  }

  if (prevContent) {
    return `Please regenerate a fresh version of this LinkedIn post about "${topic}".
Category: ${category}. Tone: ${tone}.
Make it different from the previous version while keeping the same theme.`;
  }

  return `Write a LinkedIn post about: ${topic}
Category: ${category}
Tone: ${tone}`;
}

// ── Provider-specific callers ─────────────────────────────────

async function callAnthropic(model, key, system, userPrompt) {
  const res = await llmFetch(
    `${PROVIDERS.anthropic.base}${PROVIDERS.anthropic.endpoint}`,
    key,
    {
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { 'anthropic-version': '2023-06-01' }
  );
  return res.content?.[0]?.text || extractError(res);
}

async function callOpenAI(model, key, system, userPrompt) {
  const res = await llmFetch(
    `${PROVIDERS.openai.base}${PROVIDERS.openai.endpoint}`,
    key,
    {
      model,
      messages: [
        { role: 'system',  content: system },
        { role: 'user',    content: userPrompt },
      ],
    }
  );
  return res.choices?.[0]?.message?.content || extractError(res);
}

async function callGemini(model, key, system, userPrompt) {
  const endpoint = PROVIDERS.gemini.endpoint.replace('{model}', model);
  const res = await llmFetch(
    `${PROVIDERS.gemini.base}${endpoint}`,
    key,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }
  );
  return res.candidates?.[0]?.content?.parts?.[0]?.text || extractError(res);
}

async function callLiteLLM(model, key, system, userPrompt) {
  const res = await llmFetch(
    `${PROVIDERS.litellm.base}${PROVIDERS.litellm.endpoint}`,
    key,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userPrompt },
      ],
    }
  );
  return res.choices?.[0]?.message?.content || extractError(res);
}

// ── Shared fetch ──────────────────────────────────────────────

async function llmFetch(url, apiKey, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-api-key':     apiKey,   // Anthropic uses x-api-key
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`${PROVIDERS[getConfig().provider]?.label || 'LLM'}: ${msg}`);
  }
  return data;
}

function extractError(res) {
  throw new Error('Unexpected response format from LLM provider.');
}
