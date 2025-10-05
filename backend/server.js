import express from "express";
import sqlite3 from "sqlite3";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
import { open } from "sqlite";
import bcrypt from "bcrypt";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../"))); // serve frontend files

let db;

async function initDB() {
  db = await open({
    filename: path.join(__dirname, "skillvision.db"),
    driver: sqlite3.Database
  });

  // Users table
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  // Tickets table
  await db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      priority TEXT,
      status TEXT,
      agent TEXT,
      created_at TEXT
    )
  `);

  console.log(`Connected to SQLite database at: ${path.join(__dirname, "skillvision.db")}`);
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", req.body);
  }
  next();
});


app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: "All fields are required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`, [name, email, hashedPassword, role]);
    res.json({ message: "Registered successfully" });
  } catch (err) {
    console.error("DB Error:", err.message);
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({ message: "Email already exists" });
    } else {
      res.status(500).json({ message: "Server error" });
    }
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "All fields are required" });

  try {
    const user = await db.get(`SELECT * FROM users WHERE email = ?`, [email]);
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (match) {
      res.json({
        message: "Login successful",
        user: { name: user.name, email: user.email, role: user.role }
      });
    } else {
      res.status(400).json({ message: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const users = await db.all("SELECT id, name, email, role FROM users");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/tickets", async (req, res) => {
  const { agent, status } = req.query;
  let query = "SELECT * FROM tickets";
  const params = [];

  if (agent || status) {
    const conditions = [];
    if (agent && agent !== "all") {
      conditions.push("agent = ?");
      params.push(agent);
    }
    if (status && status !== "all") {
      conditions.push("status = ?");
      params.push(status);
    }
    query += " WHERE " + conditions.join(" AND ");
  }

  try {
    const tickets = await db.all(query, params);
    res.json(tickets);
  } catch (err) {
    console.error("Get tickets error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create ticket
app.post("/tickets", async (req, res) => {
  const { title, description, priority, status, agent, created_at } = req.body;
  if (!title) return res.status(400).json({ message: "Title is required" });

  const ticketData = {
    title,
    description: description || "",
    priority: priority || "Medium",
    status: status || "Open",
    agent: agent || "",
    created_at: created_at || new Date().toISOString()
  };

  try {
    const result = await db.run(
      `INSERT INTO tickets (title, description, priority, status, agent, created_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticketData.title, ticketData.description, ticketData.priority, ticketData.status, ticketData.agent, ticketData.created_at]
    );
    const ticket = await db.get("SELECT * FROM tickets WHERE id = ?", [result.lastID]);
    res.json(ticket);
  } catch (err) {
    console.error("Ticket creation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update ticket
app.put("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, priority, status, agent } = req.body;

  try {
    const ticket = await db.get("SELECT * FROM tickets WHERE id = ?", [id]);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    await db.run(
      `UPDATE tickets SET title = ?, description = ?, priority = ?, status = ?, agent = ? WHERE id = ?`,
      [
        title || ticket.title,
        description || ticket.description,
        priority || ticket.priority,
        status || ticket.status,
        agent || ticket.agent,
        id
      ]
    );

    const updatedTicket = await db.get("SELECT * FROM tickets WHERE id = ?", [id]);
    res.json(updatedTicket);
  } catch (err) {
    console.error("Update ticket error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete ticket
app.delete("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.run("DELETE FROM tickets WHERE id = ?", [id]);
    if (result.changes === 0) return res.status(404).json({ message: "Ticket not found" });

    res.json({ message: "Ticket deleted", id });
  } catch (err) {
    console.error("Delete ticket error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/ai-response', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 300 },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const aiText = response.data.choices[0].message.content;
    res.json({ response: aiText });
  } catch (err) {
    console.error("AI Response Error:", err);
    res.status(500).json({ error: "AI response failed" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../index.html"));
});
initDB()
  .then(() => app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)))
  .catch(err => console.error("Failed to start server:", err));