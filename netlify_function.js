// netlify/functions/generate-questions.js
// ─────────────────────────────────────────────────────────────
//  Profkingkeys Q&A Tutorial — Netlify Serverless Function
//  Calls the NVIDIA API (Llama 3.3 70B) to generate 300 questions
//
//  SETUP:
//  1. Place this file at:  netlify/functions/generate-questions.js
//  2. Set NVIDIA_API_KEY in your Netlify dashboard:
//       Site Settings → Environment Variables → Add variable
//  3. Deploy to Netlify. The function is called at:
//       /.netlify/functions/generate-questions
// ─────────────────────────────────────────────────────────────

const { OpenAI } = require('openai');

// Increase function timeout in netlify.toml (see below)
exports.handler = async function (event, context) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers (needed for browser requests)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { content, mode } = body;
  if (!content || content.trim().length < 20) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Content too short' }) };
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NVIDIA_API_KEY not set in environment' }) };
  }

  // ── BUILD PROMPT ──────────────────────────────────────────
  const modeNote = mode === 'revision'
    ? 'Cover the full breadth of the content evenly.'
    : 'Prioritise concepts most likely to appear in pharmacy school exams. Weight questions toward high-yield topics.';

  const prompt = `You are an expert pharmacy educator. Based on the content below, generate exactly 300 exam-style questions for a pharmacy student.

FORMAT RULES (CRITICAL — you MUST follow exactly):
- Return ONLY valid JSON. No markdown, no code fences, no preamble.
- The JSON object must have a single key "questions" containing an array of 300 objects.
- Each question object has these fields:

For OBJECTIVE (100 questions):
{
  "id": 1,
  "type": "objective",
  "question": "Question text here?",
  "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
  "answer": "Option A text",   <-- must be the exact text of the correct option
  "explanation": "Brief explanation of why this is correct."
}

For SUBJECTIVE (100 questions, fill-in-the-gap style):
{
  "id": 101,
  "type": "subjective",
  "question": "The drug _______ is the first-line treatment for type 2 diabetes.",
  "answer": "metformin"   <-- short, exact answer (1-5 words max)
}

For THEORY (100 questions, open-ended):
{
  "id": 201,
  "type": "theory",
  "question": "Explain the mechanism of action of beta-lactam antibiotics.",
  "answer": "Full model answer here. Should be 2-5 sentences.",
  "keywords": ["peptidoglycan", "transpeptidase", "cell wall", "penicillin-binding protein", "lysis"]
}

QUESTION STRATEGY:
${modeNote}
- Questions 1–100: Objective (MCQ)
- Questions 101–200: Subjective (Fill in the Gap)  
- Questions 201–300: Theory (Open-ended with keyword checking)
- All questions must be directly derived from the provided content.
- Make questions clear, unambiguous, and at appropriate exam difficulty.
- For subjective: the blank should require a specific, checkable answer.
- For theory: include 4–8 keywords that represent key ideas the student should mention.

CONTENT TO USE:
${content.substring(0, 12000)}`;

  // ── CALL NVIDIA API ───────────────────────────────────────
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
          content: 'You are a pharmacy exam question generator. You return ONLY valid JSON with no extra text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.25,
      top_p: 0.75,
      max_tokens: 8192,
      stream: false,
    });

    const raw = completion.choices[0]?.message?.content || '';

    // ── PARSE & VALIDATE ──────────────────────────────────
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Try to extract JSON from within the response
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse AI response as JSON. Raw: ' + cleaned.substring(0, 200));
      }
    }

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('Response missing "questions" array');
    }

    // Validate and fix question structure
    const valid = parsed.questions
      .filter(q => q && q.type && q.question)
      .map((q, i) => {
        if (q.type === 'objective') {
          return {
            id: i + 1,
            type: 'objective',
            question: q.question,
            options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ['Option A','Option B','Option C','Option D'],
            answer: q.answer || q.options?.[0] || 'Option A',
            explanation: q.explanation || 'See your study materials for details.',
          };
        } else if (q.type === 'subjective') {
          return {
            id: i + 1,
            type: 'subjective',
            question: q.question,
            answer: q.answer || '',
          };
        } else {
          return {
            id: i + 1,
            type: 'theory',
            question: q.question,
            answer: q.answer || '',
            keywords: Array.isArray(q.keywords) ? q.keywords : [],
          };
        }
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ questions: valid, total: valid.length }),
    };
  } catch (err) {
    console.error('NVIDIA API error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
