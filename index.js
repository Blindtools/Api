import express from "express";
import bodyParser from "body-parser";
import { pipeline } from "@xenova/transformers";
import { createWorker } from "tesseract.js";
import fs from "fs";
import { exec } from "child_process";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));

// ====== TEXT GENERATION MODEL ======
let textGen;
(async () => {
  textGen = await pipeline("text-generation", "Xenova/llama-7b");
})();

app.post("/api/chat", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!textGen) return res.status(503).json({ error: "Model loading..." });
    const output = await textGen(prompt, { max_length: 200 });
    res.json({ response: output[0].generated_text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== IMAGE CAPTIONING MODEL ======
let imgCaption;
(async () => {
  imgCaption = await pipeline("image-to-text", "Xenova/blip-image-captioning-base");
})();

app.post("/api/image-caption", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    const buffer = Buffer.from(imageBase64, "base64");
    const result = await imgCaption(buffer);
    res.json({ description: result[0].generated_text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== OCR (TEXT FROM IMAGE) ======
app.post("/api/ocr", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    const worker = await createWorker("eng");
    const { data: { text } } = await worker.recognize(Buffer.from(imageBase64, "base64"));
    await worker.terminate();
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== TTS (TEXT TO SPEECH with Coqui) ======
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    // Save audio using Coqui TTS CLI (needs ffmpeg installed on server)
    const fileName = "output.wav";
    exec(`tts --text "${text}" --out_path ${fileName}`, (err) => {
      if (err) return res.status(500).json({ error: err.message });

      const audio = fs.readFileSync(fileName).toString("base64");
      res.json({ audioBase64: audio });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== START SERVER ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 AI API running on port ${PORT}`));

