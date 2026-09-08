const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req, res) => {
    res.json({ 
        status: '✅ Video Download Hub v5.0 - FAST YT',
        version: 'v5.0 - Piped Direct Instant',
        platforms: ['YouTube (Piped Instant)', 'Instagram', 'TikTok', 'Facebook'],
        updated: new Date().toISOString()
    });
});

function extractYTId(url) {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    return m ? m[1] : '';
}

async function fetchYTViaPiped(videoId) {
    const instances = [
        'https://pipedapi.kavin.rocks',
        'https://api.piped.private.coffee',
        'https://pipedapi.moomoo.me',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.leptun.cz',
        'https://api.piped.privacy.com.de',
        'https://pipedapi.drgns.space'
    ];
    for (const inst of instances) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch(`${inst}/streams/${videoId}`, { signal: ctrl.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(t);
            if (!r.ok) continue;
            const d = await r.json();
            if (d.title && d.videoStreams && d.videoStreams.length) {
                console.log(`[PIPED OK] ${inst} -> ${d.title.slice(0,50)}`);
                return d;
            }
        } catch (e) { continue; }
    }
    return null;
}

function getBaseCmd(url) {
    let base = 'yt-dlp --no-playlist --no-warnings --no-check-certificate --no-cache-dir --prefer-free-formats';
    base += ' --user-agent "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36"';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        base += ' --extractor-args "youtube:player_client=android,web" --extractor-args "youtube:skip=hls,dash"';
    }
    return base;
}

async function handleInfo(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL required' });
    console.log(`[INFO] ${url}`);
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    if (isYouTube) {
        const vid = extractYTId(url);
        if (vid) {
            const piped = await fetchYTViaPiped(vid);
            if (piped) {
                return res.json({
                    title: piped.title,
                    thumbnail: piped.thumbnailUrl || `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
                    uploader: piped.uploader || 'YouTube',
                    duration: piped.duration ? `${Math.floor(piped.duration/60)}:${String(piped.duration%60).padStart(2,'0')}` : '',
                    platform: 'youtube',
                    via: 'piped',
                    videoId: vid
                });
            }
        }
    }

    const cmd = `${getBaseCmd(url)} --dump-json "${url.replace(/"/g, '\\"')}"`;
    exec(cmd, { maxBuffer: 1024*1024*30, timeout: 90000 }, (err, stdout) => {
        if (!err && stdout) {
            try {
                const info = JSON.parse(stdout);
                return res.json({
                    title: info.title || 'Video',
                    thumbnail: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length-1].url : ''),
                    uploader: info.uploader || info.channel || '',
                    duration: info.duration_string || '',
                    platform: info.extractor || 'unknown',
                });
            } catch {}
        }
        if (isYouTube) {
            const vid = extractYTId(url);
            if (vid) {
                return res.json({
                    title: `YouTube Video`,
                    thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
                    uploader: 'YouTube',
                    duration: '',
                    platform: 'youtube',
                    via: 'thumbnail-fallback',
                    videoId: vid
                });
            }
        }
        return res.status(500).json({ error: 'Failed to fetch info. Link check karo.' });
    });
}

app.post('/api/info', handleInfo);
app.get('/api/info', handleInfo);

// NEW v5 - INSTANT YOUTUBE DOWNLOAD
async function handleDownload(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    const quality = req.body.quality || req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = crypto.randomBytes(8).toString('hex');
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    const vid = isYouTube ? extractYTId(url) : null;

    // YOUTUBE - INSTANT PIPED DIRECT - NO SERVER DOWNLOAD
    if (isYouTube && vid) {
        const piped = await fetchYTViaPiped(vid);
        if (piped && piped.videoStreams && piped.videoStreams.length > 0) {
            let streams = piped.videoStreams.filter(s => s.mimeType && s.mimeType.includes('mp4'));
            if (streams.length === 0) streams = piped.videoStreams;
            
            const q = quality.toString().toLowerCase();
            if (q.includes('1080')) {
                const f = streams.filter(s => (s.quality && s.quality.includes('1080')) || s.height === 1080);
                if (f.length) streams = f;
            } else if (q.includes('720')) {
                const f = streams.filter(s => (s.quality && s.quality.includes('720')) || s.height === 720);
                if (f.length) streams = f;
            } else if (q.includes('480')) {
                const f = streams.filter(s => (s.quality && s.quality.includes('480')) || s.height === 480);
                if (f.length) streams = f;
            }
            streams.sort((a,b) => (parseInt(b.height||0) - parseInt(a.height||0)));
            const best = streams[0] || piped.videoStreams[0];
            if (best && best.url) {
                console.log(`[YT INSTANT] ${best.quality} ${best.height}p`);
                // Return instant URL - frontend will open directly - NO slow server download
                return res.json({ 
                    downloadUrl: best.url, 
                    title: piped.title, 
                    via: 'piped', 
                    direct: true,
                    instant: true,
                    quality: best.quality
                });
            }
        }
        // If piped fails, try to return piped page link as fallback
        return res.json({
            downloadUrl: `https://piped.video/watch?v=${vid}`,
            title: 'YouTube Video',
            via: 'piped-page-fallback',
            direct: true,
            message: 'Piped API busy, opening piped video page'
        });
    }

    // IG / FB / TT - normal fast download via yt-dlp
    let format = 'best';
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    const base = getBaseCmd(url);
    const qLower = quality.toString().toLowerCase();
    const isAudio = qLower.includes('mp3');
    
    let cmd = '';
    if (isAudio) {
        const aq = qLower.includes('320') ? '0' : '5';
        cmd = `${base} -f "bestaudio/best" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${aq} "${url.replace(/"/g, '\\"')}"`;
    } else {
        cmd = `${base} -f "best" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
    }

    console.log(`[DOWNLOAD] ${url.slice(0,70)} | OTHER | ${quality}`);

    exec(cmd, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err) => {
        if (err) {
            const fb = `yt-dlp -f "best" -o "${outputTemplate}" "${url.replace(/"/g, '\\"')}"`;
            exec(fb, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err2) => {
                if (err2) return res.status(500).json({ error: 'Download failed. Link check karo.' });
                return sendFile(id, res);
            });
            return;
        }
        sendFile(id, res);
    });

    function sendFile(id, res) {
        try {
            const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
            if (!files.length) return res.status(500).json({ error: 'File not found' });
            const target = files.find(f=>f.endsWith('.mp4')||f.endsWith('.mp3')||f.endsWith('.webm'))||files[0];
            const filePath = path.join(TEMP_DIR, target);
            if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) return res.status(500).json({ error: 'File too small' });
            const ext = target.split('.').pop();
            const cleanName = `VideoDownloadHub_${Date.now()}.${ext}`;
            res.download(filePath, cleanName, ()=>{
                fs.unlink(filePath, ()=>{});
                files.forEach(f=>{ if(f!==target) try{fs.unlinkSync(path.join(TEMP_DIR,f))}catch{} });
            });
        } catch(e){ res.status(500).json({ error: e.message }); }
    }
}

app.post('/api/download', handleDownload);
app.get('/api/download', handleDownload);

app.get('/api/direct', async (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    if (isYouTube) {
        const vid = extractYTId(url);
        if (vid) {
            const piped = await fetchYTViaPiped(vid);
            if (piped && piped.videoStreams) {
                let streams = piped.videoStreams.filter(s=>s.mimeType && s.mimeType.includes('mp4'));
                if (streams.length === 0) streams = piped.videoStreams;
                const best = streams.sort((a,b)=>parseInt(b.height||0)-parseInt(a.height||0))[0] || piped.videoStreams[0];
                if (best) return res.json({ downloadUrl: best.url, via: 'piped', title: piped.title, instant: true });
            }
        }
    }
    const base = getBaseCmd(url);
    const cmd = `${base} -f "best" -g "${url.replace(/"/g, '\\"')}"`;
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return res.status(500).json({ error: 'Failed', details: stderr?.slice(0,500) });
        res.json({ downloadUrl: stdout.trim().split('\n')[0] });
    });
});

setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        files.forEach(f => {
            const fp = path.join(TEMP_DIR, f);
            const stat = fs.statSync(fp);
            if (now - stat.mtimeMs > 30*60*1000) fs.unlinkSync(fp);
        });
    } catch {}
}, 30*60*1000);

app.listen(PORT, ()=>console.log(`✅ Video Download Hub v5.0 FAST running on ${PORT}`));
