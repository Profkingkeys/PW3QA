// netlify/functions/netlify_function.js
// ─────────────────────────────────────────────────────────────
//  Profkingkeys Q&A Tutorial — Netlify Serverless Function
//  File MUST be saved as: netlify/functions/netlify_function.js
//  Called at: /.netlify/functions/netlify_function
//
//  SETUP:
//  1. This file stays at:  netlify/functions/netlify_function.js
//  2. Set NVIDIA_API_KEY in Netlify Dashboard:
//       Site Settings → Environment Variables → Add variable
//       Key: NVIDIA_API_KEY  Value: nvapi-xxxx...
//  3. Add package.json to your repo root with: { "dependencies": { "openai": "^4.47.0" } }
//  4. Add netlify.toml to your repo root (see env.example.txt for content)
//  5. Push to GitHub → Netlify auto-deploys
// ─────────────────────────────────────────────────────────────

const { OpenAI } = require('openai');

// CORS headers — applied to every response
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event, context) {

  // ── Handle CORS preflight (OPTIONS) ──────────────────────
  // IMPORTANT: This MUST come before the POST check
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // ── Only allow POST ────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // ── Parse request body ─────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { content, mode } = body;
  if (!content || content.trim().length < 20) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Content is too short. Please paste more text.' }) };
  }

  // ── Check API key ──────────────────────────────────────
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'NVIDIA_API_KEY is not set. Go to Netlify → Site Settings → Environment Variables and add it.' })
    };
  }

  // ── Build AI prompt ────────────────────────────────────
  const modeNote = mode === 'revision'
    ? 'Cover the full breadth of the content evenly across all topics present.'
    : 'Prioritise high-yield exam concepts. Focus on what pharmacy students are most likely to be tested on.';

  const prompt = `You are an expert pharmacy educator generating exam questions for a pharmacy student studying for exams.

Based ONLY on the content provided below, generate exactly 300 exam-style questions.

VERY IMPORTANT — Return ONLY raw valid JSON. No markdown, no code fences, no explanation. Just the JSON object.

The JSON must have one key "questions" containing an array of exactly 300 objects.

Question types and format:

OBJECTIVE (questions 1-100) — Multiple choice:
{
  "id": 1,
  "type": "objective",
  "question": "Which drug is first-line for type 2 diabetes?",
  "options": ["Metformin", "Glibenclamide", "Insulin", "Acarbose"],
  "answer": "Metformin",
  "explanation": "Metformin is the first-line drug for type 2 diabetes as per WHO guidelines due to its efficacy, safety profile and low cost."
}
Note: "answer" must be the EXACT TEXT of one of the 4 options.

SUBJECTIVE (questions 101-200) — Fill in the gap / short answer:
{
  "id": 101,
  "type": "subjective",
  "question": "The antidote for paracetamol overdose is _______.",
  "answer": "acetylcysteine"
}
Note: answer should be 1–5 words, lowercase, exact.

THEORY (questions 201-300) — Open answer with keywords:
{
  "id": 201,
  "type": "theory",
  "question": "Describe the mechanism of action of beta-lactam antibiotics.",
  "answer": "Beta-lactam antibiotics inhibit bacterial cell wall synthesis by binding to and inhibiting penicillin-binding proteins (PBPs), which are transpeptidase enzymes responsible for cross-linking peptidoglycan chains. This weakens the cell wall, leading to osmotic lysis and bacterial death.",
  "keywords": ["peptidoglycan", "penicillin-binding proteins", "transpeptidase", "cell wall", "lysis", "beta-lactam ring"]
}

Rules:
- ${modeNote}
- All 300 questions must come from the provided content — do not invent unrelated facts.
- Vary difficulty: include easy, medium and hard questions.
- Subjective answers must be checkable single phrases.
- Theory keywords (4–8) represent the most important concepts the student must mention.
- No duplicate questions.

CONTENT:
${content.substring(0, 14000)}`;

  // ── Call NVIDIA API ────────────────────────────────────
  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await openai.chat.completions.create({
      model: 'meta/llama-3.3-70b-instruct',
      messages: [
        {
          role: 'system',
          content: 'You are a pharmacy exam question generator. You output ONLY valid JSON with no markdown, no code fences, and no preamble text.',
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
    });

    const raw = completion.choices[0]?.message?.content || '';

    // ── Clean and parse ───────────────────────────────────
    let cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // If the AI still put text before the JSON, extract it
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart > 0) cleaned = cleaned.substring(jsonStart);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse failed. Raw content snippet:', cleaned.substring(0, 400));
      throw new Error('AI returned invalid JSON. Try again or reduce the content length.');
    }

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('AI response is missing the "questions" array. Please try again.');
    }

    // ── Validate and normalise each question ─────────────
    const questions = parsed.questions
      .filter(q => q && q.type && q.question && q.answer)
      .map((q, i) => {
        if (q.type === 'objective') {
          const opts = Array.isArray(q.options) && q.options.length >= 2
            ? q.options.slice(0, 4)
            : ['Option A', 'Option B', 'Option C', 'Option D'];
          // Ensure answer matches one of the options
          const answerInOpts = opts.includes(q.answer);
          return {
            id: i + 1,
            type: 'objective',
            question: String(q.question).trim(),
            options: opts.map(String),
            answer: answerInOpts ? String(q.answer) : opts[0],
            explanation: String(q.explanation || 'Refer to your study materials.').trim(),
          };
        } else if (q.type === 'subjective') {
          return {
            id: i + 1,
            type: 'subjective',
            question: String(q.question).trim(),
            answer: String(q.answer).trim().toLowerCase(),
          };
        } else {
          return {
            id: i + 1,
            type: 'theory',
            question: String(q.question).trim(),
            answer: String(q.answer).trim(),
            keywords: Array.isArray(q.keywords)
              ? q.keywords.map(String).slice(0, 10)
              : [],
          };
        }
      });

    if (questions.length < 10) {
      throw new Error(`Only ${questions.length} valid questions were generated. Try pasting more content.`);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ questions, total: questions.length }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || 'Unknown server error. Check Netlify function logs.' }),
    };
  }
};
