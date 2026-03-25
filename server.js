// ─── EVOLVE IQ TODOS BACKEND ─────────────────────────────────────────────────
// Flow: Webhook → Data Manipulation → Claude AI → Parse Tasks → Supabase DB
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { config } from "dotenv";
config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── ANTHROPIC CLIENT ────────────────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── SYSTEM PROMPT (from your n8n AI Agent node) ─────────────────────────────
const SYSTEM_PROMPT = `You are an action-item extraction system. Your task is to extract action items that are clearly assigned to Jorge, using only the information provided in the meeting transcript.

IMPORTANT PRINCIPLES:
1. Include a task ONLY if it is clearly directed to Jorge.
The assignment does NOT need to use exact phrases like:
- "Jorge will..."
- "Jorge is responsible for..."
However, it MUST be clear from context that Jorge is the person expected to take action.

Examples of valid assignments:
- Someone asks Jorge directly to do something
- Jorge verbally accepts or confirms responsibility
- A task is discussed and clearly framed as something Jorge will follow up on

2. Do NOT create tasks from:
- Ideas, strategies, or brainstorming
- Opinions or advice
- General statements with no clear owner
- Tasks assigned to other participants

3. Do NOT invent tasks or fill in missing responsibilities.

4. If no valid tasks assigned to Jorge exist, return an EMPTY JSON array: []

---

TASK CLEANING RULES:
- Remove filler words (e.g., "uh", "um", "like", "you know")
- Keep all meaningful and relevant words
- Rewrite the task clearly while preserving the original intent and wording

---

For each VALID task assigned to Jorge, return an object with EXACTLY these fields:
- "Task": A clear and concise description of the task, based on the transcript.
- "Client": The client name provided in the input.
- "Due Date": Include only if explicitly mentioned. If not mentioned, use an empty string.
- "Notes": Brief supporting context explaining why this task exists.
- "Priority": A number from 1 to 5. Use stated urgency if mentioned; otherwise infer from context.
- "Client Company": Based on the client email, define which company they belong to.
- "Type of call": Either "Internal" (Evolve IQ internal call) or "External" (client/partner call).

---

OUTPUT FORMAT RULES (MANDATORY):
- ALWAYS IN ENGLISH
- Return ONLY a valid JSON array.
- Do NOT wrap the output in markdown.
- Do NOT include explanations, comments, or extra text.
- Do NOT include keys other than those specified.`;

// ─── HELPER: Parse AI output ──────────────────────────────────────────────────
function parseAgentOutput(rawOutput) {
  let tasks = rawOutput;
  if (typeof tasks === "string") {
    const cleaned = tasks.replace(/```json/g, "").replace(/```/g, "").trim();
    tasks = JSON.parse(cleaned);
  }
  if (!Array.isArray(tasks)) throw new Error("AI output is not a valid array");
  return tasks.map((task) => ({
    id: randomUUID(),
    task: task.Task || "",
    client: task.Client || "",
    client_company: task["Client Company"] || "",
    type_of_call: task["Type of call"] || "External",
    due_date: task["Due Date"] || "",
    notes: task.Notes || "",
    priority: mapPriority(Number(task.Priority) || 3),
    status: "pending",
    source: "call",
  }));
}

function mapPriority(num) {
  if (num >= 4) return "high";
  if (num === 3) return "medium";
  return "low";
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/tasks - Return all tasks from Supabase
app.get("/api/tasks", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("❌ GET /api/tasks error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks - Add a new task to Supabase
app.post("/api/tasks", async (req, res) => {
  try {
    const newTask = {
      id: randomUUID(),
      task: req.body.task || "",
      client: req.body.client || "",
      client_company: req.body.clientCompany || "",
      type_of_call: req.body.typeOfCall || "External",
      due_date: req.body.dueDate || "",
      notes: req.body.notes || "",
      priority: req.body.priority || "medium",
      status: req.body.status || "pending",
      source: "manual",
    };
    const { data, error } = await supabase
      .from("tasks")
      .insert(newTask)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("❌ POST /api/tasks error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/tasks/:id - Update a task in Supabase
app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const updates = {};
    if (req.body.task !== undefined)     updates.task = req.body.task;
    if (req.body.client !== undefined)   updates.client = req.body.client;
    if (req.body.dueDate !== undefined)  updates.due_date = req.body.dueDate;
    if (req.body.due_date !== undefined) updates.due_date = req.body.due_date;
    if (req.body.notes !== undefined)    updates.notes = req.body.notes;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.status !== undefined)   updates.status = req.body.status;

    const { data, error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("❌ PATCH /api/tasks error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tasks/:id - Delete a task from Supabase
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("❌ DELETE /api/tasks error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── WEBHOOK ROUTE (receives Fathom call transcripts) ────────────────────────
app.post("/api/webhook/fathom", async (req, res) => {
  try {
    console.log("📦 Fathom payload:", JSON.stringify(req.body).substring(0, 1000));

    const rawBody = req.body;
    const transcript = rawBody.transcript || rawBody.text || rawBody.content || 
                       (rawBody.meeting && rawBody.meeting.transcript) ||
                       JSON.stringify(rawBody);
    const client = rawBody.client || rawBody.contact || 
                   (rawBody.meeting && rawBody.meeting.title) || "Unknown";

    console.log(`\n📞 New call received from client: ${client}`);
    const cleanedTranscript = typeof transcript === "string"
      ? transcript.replace(/\s+/g, " ").trim()
      : JSON.stringify(transcript);

    console.log("🤖 Sending to Claude for task extraction...");
    const userPrompt = `Extract action items from this meeting transcript.
INPUT:
- Meeting transcript: ${cleanedTranscript}
- Client: ${client || "Unknown"}
revision_mode = false`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawOutput = response.content[0].text;
    const extractedTasks = parseAgentOutput(rawOutput);
    console.log(`📋 Extracted ${extractedTasks.length} tasks`);

    if (extractedTasks.length > 0) {
      const { error } = await supabase.from("tasks").insert(extractedTasks);
      if (error) throw error;
    }

    res.json({
      success: true,
      tasksExtracted: extractedTasks.length,
      tasks: extractedTasks,
    });
  } catch (error) {
    console.error("❌ Webhook error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── CHAT ROUTE (real Claude AI with Supabase task context) ──────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    const taskSummary = tasks && tasks.length > 0
      ? `Current tasks in the system:\n${tasks.map(t => `- ${t.task} (${t.status}, ${t.priority} priority, client: ${t.client})`).join("\n")}`
      : "No tasks in the system yet.";

    const systemMsg = `You are Jorge's AI assistant for Evolve IQ. You help manage tasks extracted from sales and client calls.

${taskSummary}

Be concise, helpful, and proactive. Reference actual task data when relevant.`;

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemMsg,
      messages,
    });

    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error("❌ Chat error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    const { count } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true });
    res.json({
      status: "ok",
      database: "supabase",
      tasks: count || 0,
      message: "Evolve IQ Todos backend running with Supabase!",
    });
  } catch (error) {
    res.json({ status: "ok", database: "supabase", message: "Running!" });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Evolve IQ Todos backend running on http://localhost:${PORT}`);
  console.log(`🗄️  Database: Supabase`);
  console.log(`📋 Tasks:    http://localhost:${PORT}/api/tasks`);
  console.log(`🔗 Webhook:  http://localhost:${PORT}/api/webhook/fathom`);
  console.log(`💬 Chat:     http://localhost:${PORT}/api/chat\n`);
});