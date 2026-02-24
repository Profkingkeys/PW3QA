// netlify/functions/netlify_function.js
// ─────────────────────────────────────────────────────────────
//  Profkingkeys Q&A Tutorial — Netlify Serverless Function
//
//  ✅ ZERO npm dependencies — uses Node 18 native fetch
//  ✅ No package.json needed for this function
//  ✅ No node_bundler needed
//
//  FILE LOCATION:  netlify/functions/netlify_function.js
//  ENDPOINT URL:   /.netlify/functions/netlify_function
//
//  NETLIFY SETUP:
//  1. Netlify Dashboard → Site Settings → Environment Variables
//  2. Add:  NVIDIA_API_KEY  =  nvapi-your-key-here
//  3. Redeploy the site
//
//  GET FREE NVIDIA KEY: https://build.nvidia.com → API Keys
// ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {

  // ── CORS preflight ── must be first
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  // ── Only POST allowed ──
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  // ── Parse request ──
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON in request body' }),
    };
  }

  const { content, mode } = body;

  if (!content || content.trim().length < 30) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Content is too short. Please paste more text.' }),
    };
  }

  // ── Check API key ──
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || !apiKey.startsWith('nvapi-')) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'NVIDIA_API_KEY is missing or invalid. Go to Netlify → Site Settings → Environment Variables and add your key (starts with nvapi-).',
      }),
    };
  }

  // ── Build prompt ──
  const examFocus = mode === 'revision'
    ? 'Cover all topics in the content evenly.'
    : 'Focus on high-yield exam topics. Prioritise concepts most likely to appear in pharmacy school exams.';

  const prompt = `You are an expert pharmacy educator. Generate exactly 300 exam questions for a pharmacy student based ONLY on the content below.

CRITICAL: Return ONLY raw valid JSON. No markdown. No code fences. No preamble. Start your response with { and end with }.

JSON structure:
{
  "questions": [
    ... array of 300 question objects ...
  ]
}

OBJECTIVE questions (IDs 1-100) — Multiple choice with 4 options:
{ "id": 1, "type": "objective", "question": "Which drug...?", "options": ["Drug A", "Drug B", "Drug C", "Drug D"], "answer": "Drug A", "explanation": "Drug A is correct because..." }
RULE: "answer" must be the EXACT TEXT of one of the 4 options.

SUBJECTIVE questions (IDs 101-200) — Short fill-in-the-gap:
{ "id": 101, "type": "subjective", "question": "The first-line drug for type 2 diabetes is _______.", "answer": "metformin" }
RULE: answer is 1-5 words, lowercase.

THEORY questions (IDs 201-300) — Open answer with keywords:
{ "id": 201, "type": "theory", "question": "Explain the mechanism of beta-lactam antibiotics.", "answer": "Full 2-4 sentence model answer here.", "keywords": ["peptidoglycan", "transpeptidase", "cell wall", "lysis"] }
RULE: include 4-8 keywords the student should mention.

STRATEGY: ${examFocus}
- All questions must come from the content below.
- No duplicate questions.
- Vary difficulty: mix easy, medium, hard.

CONTENT:
${content.substring(0, 13000)}`;

  // ── Call NVIDIA API using native fetch (no npm needed) ──
  let apiResponse;
  try {
    apiResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        messages: [
          {
            role: 'system',
            content: 'You are a pharmacy exam question generator. You output ONLY valid JSON with no markdown, no code fences, and no extra text before or after the JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 8192,
        stream: false,
      }),
    });
  } catch (networkErr) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Could not reach NVIDIA API: ' + networkErr.message }),
    };
  }

  if (!apiResponse.ok) {
    let errBody = '';
    try { errBody = await apiResponse.text(); } catch {}
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: `NVIDIA API returned ${apiResponse.status}. Check your API key. Details: ${errBody.substring(0, 200)}`,
      }),
    };
  }

  let apiData;
  try {
    apiData = await apiResponse.json();
  } catch {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'NVIDIA API returned non-JSON response.' }),
    };
  }

  const rawContent = apiData.choices?.[0]?.message?.content || '';
  if (!rawContent) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'NVIDIA API returned empty content.' }),
    };
  }

  // ── Clean & parse JSON ──
  let cleaned = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Find start of JSON object in case there's preamble
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart > 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('JSON parse error. Content snippet:', cleaned.substring(0, 500));
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'AI returned invalid JSON. Please try again. If problem persists, reduce the content length.',
      }),
    };
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'AI response missing "questions" array. Please try again.' }),
    };
  }

  // ── Validate & normalise ──
  const questions = parsed.questions
    .filter(q => q && q.type && q.question && q.answer)
    .map((q, i) => {
      if (q.type === 'objective') {
        const opts = Array.isArray(q.options) && q.options.length >= 2
          ? q.options.slice(0, 4).map(String)
          : ['Option A', 'Option B', 'Option C', 'Option D'];
        const answer = opts.includes(String(q.answer)) ? String(q.answer) : opts[0];
        return {
          id: i + 1, type: 'objective',
          question: String(q.question).trim(),
          options: opts,
          answer,
          explanation: String(q.explanation || 'Refer to your study materials.').trim(),
        };
      } else if (q.type === 'subjective') {
        return {
          id: i + 1, type: 'subjective',
          question: String(q.question).trim(),
          answer: String(q.answer).trim().toLowerCase(),
        };
      } else {
        return {
          id: i + 1, type: 'theory',
          question: String(q.question).trim(),
          answer: String(q.answer).trim(),
          keywords: Array.isArray(q.keywords) ? q.keywords.map(String).slice(0, 10) : [],
        };
      }
    });

  if (questions.length < 5) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: `Only ${questions.length} valid questions generated. Please paste more content and try again.`,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ questions, total: questions.length }),
  };
};
