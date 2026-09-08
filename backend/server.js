const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req,res) => res.json({ status: '✅ Video Download Hub v8 - Direct No Popup - SaveFrom Style', mode: 'Cobalt + Piped Direct File' }));

function getYtId(url){
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?#\/]+)/);
  return m ? m[1] : null;
}

// ===== SAVEFROM STYLE DIRECT LINK =====
async function getCobaltDirect(youtubeUrl, quality='1080'){
  const apis = ['https://api.cobalt.tools', 'https://co.wuk.sh', 'https://api.cobalt.ahmedrangel.com'];
  for(const api of apis){
    try{
      const controller = new AbortController();
      setTimeout(()=>controller.abort(), 8000);
      const r = await fetch(`${api}/api/json`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({ url: youtubeUrl, vQuality: quality.replace('p',''), filenamePattern: 'basic', isAudioOnly: false }),
        signal: controller.signal
      });
      if(!r.ok) continue;
      const j = await r.json();
      if(j.url){ console.log(`[COBALT OK] ${api}`); return j.url; }
    }catch(e){ console.log(`[COBALT FAIL] ${api} ${e.message}`); }
  }
  return null;
}

async function getPipedDirect(videoId, quality='1080'){
  const apis = ['https://pipedapi.kavin.rocks','https://api.piped.private.coffee','https://pipedapi.moomoo.me','https://pipedapi.adminforge.de'];
  for(const base of apis){
    try{
      const controller = new AbortController();
      setTimeout(()=>controller.abort(), 7000);
      const r = await fetch(`${base}/streams/${videoId}`, { headers:{'User-Agent':'Mozilla/5.0'}, signal: controller.signal });
      if(!r.ok) continue;
      const data = await r.json();
      if(!data.videoStreams) continue;
      let streams = data.videoStreams.filter(s=>s.mimeType && s.mimeType.includes('mp4'));
      if(streams.length===0) streams = data.videoStreams;
      const qNum = parseInt(quality) || 1080;
      let best = streams.find(s=>s.height===qNum) || streams.sort((a,b)=>b.height-a.height)[0];
      if(best?.url){ console.log(`[PIPED OK] ${base} ${best.quality}`); return best.url; }
    }catch(e){}
  }
  return null;
}

// ===== INFO =====
app.post('/api/info', (req,res)=>{
  const url = (req.body.url||'').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  const ytId = getYtId(url);
  if(ytId){
    return res.json({
      title: 'YouTube Video',
      thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      uploader: 'YouTube',
      platform: 'youtube',
      videoId: ytId
    });
  }
  // For IG/FB/TT use yt-dlp info
  const cmd = `yt-dlp --no-playlist --dump-json "${url.replace(/"/g,'\\"')}"`;
  exec(cmd, {timeout:20000, maxBuffer:1024*1024*10}, (err,stdout)=>{
    if(!err && stdout){
      try{
        const info = JSON.parse(stdout.split('\n')[0]);
        return res.json({ title: info.title||'Video', thumbnail: info.thumbnail||'', uploader: info.uploader||'' });
      }catch{}
    }
    return res.json({ title: 'Video', thumbnail: '' });
  });
});
app.get('/api/info', (req,res)=>{ req.body={url:req.query.url}; return app._router.handle(req,res); });

// ===== MAIN DOWNLOAD - DIRECT FILE, NO POPUP =====
app.get('/api/download', async (req,res)=>{
  const url = (req.query.url||'').trim();
  const quality = (req.query.quality||'1080').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  const ytId = getYtId(url);
  console.log(`[REQ] ${url.slice(0,70)} q=${quality} ytId=${ytId}`);

  if(ytId){
    let directUrl = await getCobaltDirect(url, quality);
    if(!directUrl) directUrl = await getPipedDirect(ytId, quality);
    if(!directUrl) return res.status(500).json({error:'YouTube servers busy hai, 10 sec baad 720p try karo'});

    try{
      const videoRes = await fetch(directUrl, { headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'} });
      if(!videoRes.ok) throw new Error('fetch '+videoRes.status);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      if(buf.length < 5000) throw new Error('small file');
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="YT_${ytId}_${quality}.mp4"`);
      res.setHeader('Access-Control-Allow-Origin','*');
      console.log(`[SEND FILE] ${buf.length} bytes`);
      return res.send(buf);
    }catch(e){
      console.log(`[PROXY FAIL] ${e.message} - sending json fallback`);
      return res.json({ downloadUrl: directUrl, filename: `YT_${ytId}.mp4`, direct: true });
    }
  }

  // IG / FB / TikTok
  const id = crypto.randomBytes(8).toString('hex');
  const outTpl = path.join(TEMP_DIR, `${id}.%(ext)s`);
  const cmd = `yt-dlp --no-playlist -f "best" -o "${outTpl}" --merge-output-format mp4 "${url.replace(/"/g,'\\"')}"`;
  exec(cmd, {timeout:120000, maxBuffer:1024*1024*100}, (err)=>{
    try{
      const files = fs.readdirSync(TEMP_DIR).filter(f=>f.startsWith(id));
      if(files.length===0) return res.status(500).json({error:'Download failed'});
      const file = path.join(TEMP_DIR, files[0]);
      res.download(file, `video_${Date.now()}.mp4`, ()=>{ try{fs.unlinkSync(file);}catch{} });
    }catch(e){ res.status(500).json({error:e.message}); }
  });
});

app.listen(PORT, ()=>console.log(`✅ v8 Direct No Popup running on ${PORT}`));
