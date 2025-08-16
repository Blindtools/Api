import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import ollama from "ollama";

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "🚀 Blind Bulls Assistant API is running!" });
});

// 🔹 Chat with AI
app.post("/chat", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Call Ollama LLaMA3 model
    const response = await ollama.chat({
      model: "llama3",
      messages: [{ role: "user", content: prompt }],
    });

    let aiResponse = response.message.content;

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// 🔹 Real-time information with Web Search
app.post("/research", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    // Example free search API (DuckDuckGo Instant Answer)
    const searchRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    );
    const data = await searchRes.json();

    // Summarize with Ollama
    const summary = await ollama.chat({
      model: "llama3",
      messages: [
        { role: "system", content: "Summarize search results in simple terms." },
        { role: "user", content: JSON.stringify(data) },
      ],
    });

    res.json({ research: summary.message.content });
  } catch (error) {
    console.error("Research Error:", error);
    res.status(500).json({ error: "Failed to fetch research data" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});

