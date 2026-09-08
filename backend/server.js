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
        status: '✅ Video Download Hub - LATEST 2026',
        version: 'v4.0 - Piped + Android + All Platforms',
        platforms: ['YouTube (Piped fix)', 'Instagram', 'TikTok', 'Facebook'],
        updated: new Date().toISOString()
    });
});

function getBaseCmd(url) {
    let base = 'yt-dlp --no-playlist --no-warnings --no-check-certificate --no-cache-dir --prefer-free-formats';
    base += ' --user-agent "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36"';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        base += ' --extractor-args "youtube:player_client=android,web" --extractor-args "youtube:skip=hls,dash"';
    }
    return base;
}

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
        'https://pipedapi.leptun.cz'
    ];
    for (const inst of instances) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 10000);
            const r = await fetch(`${inst}/streams/${videoId}`, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
            clearTimeout(t);
            if (!r.ok) continue;
            const d = await r.json();
            if (d.title) {
                console.log(`[PIPED OK] ${inst} -> ${d.title.slice(0,50)}`);
                return d;
            }
        } catch (e) { continue; }
    }
    return null;
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
    exec(cmd, { maxBuffer: 1024*1024*30, timeout: 90000 }, (err, stdout, stderr) => {
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
        console.log(`[INFO FAIL] ${stderr?.slice(0,500)}`);
        exec(`yt-dlp --no-playlist --dump-json --no-warnings "${url.replace(/"/g, '\\"')}"`, { maxBuffer: 1024*1024*20, timeout: 90000 }, async (e2, s2) => {
            if (!e2 && s2) {
                try {
                    const info = JSON.parse(s2);
                    return res.json({
                        title: info.title || 'Video',
                        thumbnail: info.thumbnail || '',
                        uploader: info.uploader || '',
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
            return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr?.slice(0,600) });
        });
    });
}

app.post('/api/info', handleInfo);
app.get('/api/info', handleInfo);

async function handleDownload(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    const quality = req.body.quality || req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = crypto.randomBytes(8).toString('hex');
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    const vid = isYouTube ? extractYTId(url) : null;

    // YOUTUBE - Try Piped first for instant download link
    if (isYouTube && vid) {
        try {
            const piped = await fetchYTViaPiped(vid);
            if (piped && piped.videoStreams && piped.videoStreams.length > 0) {
                let streams = piped.videoStreams.filter(s => s.mimeType && s.mimeType.includes('mp4'));
                const q = quality.toString();
                if (q.includes('1080')) {
                    const f = streams.filter(s => s.quality && s.quality.includes('1080'));
                    if (f.length) streams = f;
                } else if (q.includes('720')) {
                    const f = streams.filter(s => s.quality && s.quality.includes('720'));
                    if (f.length) streams = f;
                } else if (q.includes('480')) {
                    const f = streams.filter(s => s.quality && s.quality.includes('480'));
                    if (f.length) streams = f;
                }
                streams.sort((a,b) => (parseInt(b.height||b.quality)||0) - (parseInt(a.height||a.quality)||0));
                const best = streams[0] || piped.videoStreams[0];
                if (best && best.url) {
                    console.log(`[YT PIPED DIRECT] ${best.quality} -> ${best.url.slice(0,80)}`);
                    // Return direct URL - frontend will download it directly (no popup)
                    if (req.query.direct === 'true' || req.body.direct === true) {
                        return res.json({ downloadUrl: best.url, title: piped.title, via: 'piped', direct: true });
                    }
                    // Otherwise proxy download via server to avoid CORS
                    const outputFile = path.join(TEMP_DIR, `${id}.mp4`);
                    const dlCmd = `curl -L -o "${outputFile}" -A "Mozilla/5.0" "${best.url.replace(/"/g, '\\"')}"`;
                    exec(dlCmd, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err) => {
                        if (!err && fs.existsSync(outputFile) && fs.statSync(outputFile).size > 10000) {
                            return sendFile(id, res);
                        }
                        // Fallback to direct URL json
                        return res.json({ downloadUrl: best.url, title: piped.title, via: 'piped', direct: true });
                    });
                    return;
                }
            }
        } catch (e) {
            console.log(`[PIPED DOWNLOAD ERROR] ${e.message}`);
        }
    }

    // ALL PLATFORMS - yt-dlp download
    let format = 'best';
    if (isYouTube) {
        const q = quality.toString().toLowerCase();
        if (q.includes('1080')) format = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]/best';
        else if (q.includes('720')) format = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best';
        else if (q.includes('480')) format = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]/best';
        else format = 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best';
    }

    const qLower = quality.toString().toLowerCase();
    const isAudio = qLower.includes('mp3');
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    const base = getBaseCmd(url);

    let cmd = '';
    if (isAudio) {
        const aq = qLower.includes('320') ? '0' : '5';
        cmd = `${base} -f "bestaudio/best" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${aq} "${url.replace(/"/g, '\\"')}"`;
    } else {
        cmd = `${base} -f "${format}" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
    }

    console.log(`[DOWNLOAD] ${url.slice(0,70)} | ${isYouTube?'YT':'OTHER'} | ${quality} | ${format}`);

    exec(cmd, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err, stdout, stderr) => {
        if (err) {
            console.log(`[DL FAIL] ${stderr?.slice(0,700)}`);
            const fb1 = `${base} -f "best" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
            exec(fb1, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err2) => {
                if (err2) {
                    const fb2 = `yt-dlp -f "best" -o "${outputTemplate}" "${url.replace(/"/g, '\\"')}"`;
                    exec(fb2, { maxBuffer: 1024*1024*300, timeout: 180000 }, (err3) => {
                        if (err3) return res.status(500).json({ error: 'Download failed. YouTube ke liye thodi der baad try karo, IG/FB/TT 100% working hai.', details: stderr?.slice(0,700) });
                        return sendFile(id, res);
                    });
                    return;
                }
                return sendFile(id, res);
            });
            return;
        }
        sendFile(id, res);
    });

    function sendFile(id, res) {
        try {
            const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
            if (!files.length) return res.status(500).json({ error: 'File not found after download' });
            const target = files.find(f=>f.endsWith('.mp4')||f.endsWith('.mp3')||f.endsWith('.webm'))||files[0];
            const filePath = path.join(TEMP_DIR, target);
            if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) return res.status(500).json({ error: 'File too small or corrupted' });
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
                const stream = piped.videoStreams.find(s=>s.mimeType.includes('mp4') && s.quality.includes('1080')) || piped.videoStreams.find(s=>s.mimeType.includes('mp4')) || piped.videoStreams[0];
                if (stream) return res.json({ downloadUrl: stream.url, via: 'piped', title: piped.title });
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

// Clean old temp files every 30 min
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

app.listen(PORT, ()=>console.log(`✅ LATEST Video Download Hub v4.0 running on ${PORT} - Piped + All Platforms`));
