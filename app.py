import os, io, json, asyncio, base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from PyPDF2 import PdfReader
from PIL import Image
import pytesseract
import websockets

# ===== Gemini Live session helper (inline) =====
GEMINI_LIVE_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.LLMService/LiveSession"

class GeminiLiveSession:
    def __init__(self, api_key: str, model: str = "models/gemini-2.5-flash"):
        self.api_key = api_key
        self.model = model
        self.ws = None

    async def connect(self):
        url = f"{GEMINI_LIVE_WS}?key={self.api_key}"
        self.ws = await websockets.connect(url, max_size=32 * 1024 * 1024)
        setup = {
            "setup": {
                "model": self.model,
                "response": {"modalities": ["AUDIO","TEXT"], "instructions": "You are a helpful assistant."}
            }
        }
        await self.ws.send(json.dumps(setup))

    async def close(self):
        if self.ws: await self.ws.close()

    async def send_user_text(self, text: str):
        await self.ws.send(json.dumps({"input":{"text":text}}))

    async def send_user_audio(self, pcm16: bytes):
        evt = {"input":{"audio":{"mime_type":"audio/pcm;rate=16000","data":base64.b64encode(pcm16).decode()}}}
        await self.ws.send(json.dumps(evt))

    async def send_user_video(self, jpg: bytes):
        evt = {"input":{"video":{"mime_type":"image/jpeg","data":base64.b64encode(jpg).decode()}}}
        await self.ws.send(json.dumps(evt))

    async def receive(self):
        async for msg in self.ws: yield json.loads(msg)

# ===== FastAPI app =====
API_KEY = os.environ.get("GOOGLE_API_KEY")
MODEL_ID = os.environ.get("GEMINI_MODEL","models/gemini-2.5-flash")
app = FastAPI()

@app.get("/")
async def root():
    # Inline HTML + JS
    return HTMLResponse("""
<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Gemini Realtime Tool</title></head>
<body>
<h1>Gemini AI — Realtime Voice/Video</h1>
<div>
  <button id="startBtn">Start Call</button>
  <button id="endBtn" disabled>End Call</button>
  <button id="muteBtn" disabled>Mute</button>
  <button id="camBtn" disabled>Camera Off</button>
</div>
<video id="video" autoplay muted playsinline width="320" height="240"></video>
<div><input id="ask" placeholder="Ask anything"/><button id="sendText">Send</button></div>
<pre id="captions"></pre>
<script>
let ws, mediaStream, audioCtx, processor, micEnabled=true, camEnabled=true;
const cap=document.getElementById("captions");
function log(t){cap.textContent+=t+"\\n";cap.scrollTop=cap.scrollHeight;}
function encodePCM16(f32){const b=new ArrayBuffer(f32.length*2),v=new DataView(b);for(let i=0;i<f32.length;i++){let s=Math.max(-1,Math.min(1,f32[i]));v.setInt16(i*2,s<0?s*0x8000:s*0x7FFF,true);}return new Uint8Array(b);}
async function startCall(){
 ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws");
 ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.type==="gemini"){if(m.data.output&&m.data.output.text){log("AI: "+m.data.output.text);}if(m.data.output&&m.data.output.audio){const b=atob(m.data.output.audio.data);const buf=new Uint8Array(b.length);for(let i=0;i<b.length;i++)buf[i]=b.charCodeAt(i);if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});const ab=await audioCtx.decodeAudioData(buf.buffer.slice(0));const src=audioCtx.createBufferSource();src.buffer=ab;src.connect(audioCtx.destination);src.start();}}};
 mediaStream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
 document.getElementById("video").srcObject=mediaStream;
 audioCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
 const source=audioCtx.createMediaStreamSource(mediaStream);
 processor=audioCtx.createScriptProcessor(4096,1,1);
 processor.onaudioprocess=e=>{if(!micEnabled||!ws||ws.readyState!==1)return;const f=e.inputBuffer.getChannelData(0);const pcm=encodePCM16(f);ws.send(JSON.stringify({type:"audio",pcm16:btoa(String.fromCharCode(...pcm))}));};
 source.connect(processor);processor.connect(audioCtx.destination);
 document.getElementById("startBtn").disabled=true;document.getElementById("endBtn").disabled=false;
}
function endCall(){if(ws)ws.close();if(processor)processor.disconnect();if(mediaStream)mediaStream.getTracks().forEach(t=>t.stop());document.getElementById("startBtn").disabled=false;document.getElementById("endBtn").disabled=true;}
document.getElementById("startBtn").onclick=startCall;
document.getElementById("endBtn").onclick=endCall;
document.getElementById("sendText").onclick=()=>{const t=document.getElementById("ask").value;ws.send(JSON.stringify({type:"text",text:t}));log("You: "+t);};
</script>
</body>
</html>
""")

class AskBody(BaseModel): text:str

@app.websocket("/ws")
async def ws_endpoint(websocket:WebSocket):
    await websocket.accept()
    if not API_KEY: 
        await websocket.send_json({"error":"Missing GOOGLE_API_KEY"});await websocket.close();return
    session=GeminiLiveSession(API_KEY,MODEL_ID);await session.connect()
    async def client_to_gemini():
        try:
            while True:
                msg=await websocket.receive_text()
                data=json.loads(msg)
                if data["type"]=="text": await session.send_user_text(data["text"])
                elif data["type"]=="audio": await session.send_user_audio(base64.b64decode(data["pcm16"]))
        except WebSocketDisconnect: pass
    async def gemini_to_client():
        async for evt in session.receive():
            await websocket.send_json({"type":"gemini","data":evt})
    tasks=[asyncio.create_task(client_to_gemini()),asyncio.create_task(gemini_to_client())]
    await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
    for t in tasks:t.cancel()
    await session.close()
