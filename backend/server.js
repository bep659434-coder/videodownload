const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req, res) => {
    res.json({ status: '✅ Video Download Hub Running', youtube: 'Piped + Android fallback' });
});

function getBaseCmd(url) {
    let base = 'yt-dlp --no-playlist --no-warnings --no-check-certificate --no-cache-dir';
    base += ' --user-agent "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36"';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        base += ' --extractor-args "youtube:player_client=android,web" --extractor-args "youtube:skip=hls,dash"';
    }
    return base;
}

function extractYTId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
    return match ? match[1] : '';
}

// Piped API - YouTube ke liye free alternative
async function fetchYTViaPiped(videoId) {
    const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://api.piped.private.coffee',
        'https://pipedapi.moomoo.me',
        'https://pipedapi.adminforge.de'
    ];
    for (const instance of pipedInstances) {
        try {
            console.log(`[PIPED] Trying ${instance}/streams/${videoId}`);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            const res = await fetch(`${instance}/streams/${videoId}`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
            clearTimeout(timeout);
            if (!res.ok) continue;
            const data = await res.json();
            if (data.title) {
                console.log(`[PIPED SUCCESS] ${data.title.slice(0,60)}`);
                return {
                    title: data.title,
                    thumbnail: data.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                    uploader: data.uploader || 'YouTube',
                    duration: data.duration ? `${Math.floor(data.duration/60)}:${String(data.duration%60).padStart(2,'0')}` : '',
                    platform: 'youtube',
                    pipedData: data
                };
            }
        } catch (e) {
            console.log(`[PIPED FAIL] ${instance}: ${e.message}`);
            continue;
        }
    }
    return null;
}

async function handleInfo(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL required' });
    console.log(`[INFO] ${url}`);
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    // YouTube ke liye pehle Piped try karo (fast + reliable)
    if (isYouTube) {
        const videoId = extractYTId(url);
        if (videoId) {
            const pipedInfo = await fetchYTViaPiped(videoId);
            if (pipedInfo) {
                return res.json({
                    title: pipedInfo.title,
                    thumbnail: pipedInfo.thumbnail,
                    uploader: pipedInfo.uploader,
                    duration: pipedInfo.duration,
                    platform: 'youtube',
                    via: 'piped'
                });
            }
        }
    }

    const cmd = `${getBaseCmd(url)} --dump-json "${url.replace(/"/g, '\\"')}"`;
    exec(cmd, { maxBuffer: 1024*1024*30, timeout: 90000 }, (err, stdout, stderr) => {
        if (!err && stdout) {
            try {
                const info = JSON.parse(stdout);
                console.log(`[INFO SUCCESS yt-dlp] ${info.title?.slice(0,60)}`);
                return res.json({
                    title: info.title || 'Video',
                    thumbnail: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length-1].url : ''),
                    uploader: info.uploader || info.channel || '',
                    duration: info.duration_string || '',
                    platform: info.extractor || 'youtube',
                });
            } catch {}
        }
        console.error('[INFO FAIL yt-dlp]', stderr?.slice(0,600));
        // Last fallback: simple yt-dlp
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
            // Agar YouTube hai to dobara Piped try with direct thumbnail
            if (isYouTube) {
                const videoId = extractYTId(url);
                if (videoId) {
                    return res.json({
                        title: `YouTube Video ${videoId}`,
                        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                        uploader: 'YouTube',
                        duration: '',
                        platform: 'youtube',
                        via: 'thumbnail-fallback',
                        warning: 'Info limited due to IP block, but download will work'
                    });
                }
            }
            return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr?.slice(0,800) });
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

    // YouTube ke liye Piped se direct download
    if (isYouTube) {
        const videoId = extractYTId(url);
        if (videoId) {
            try {
                const pipedInstances = [
                    'https://pipedapi.kavin.rocks',
                    'https://api.piped.private.coffee',
                    'https://pipedapi.moomoo.me'
                ];
                for (const instance of pipedInstances) {
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 12000);
                        const resPiped = await fetch(`${instance}/streams/${videoId}`, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (!resPiped.ok) continue;
                        const data = await resPiped.json();
                        // Best quality video stream
                        let videoUrl = null;
                        if (data.videoStreams && data.videoStreams.length > 0) {
                            // 1080p, 720p prefer
                            const q = quality.toString();
                            let filtered = data.videoStreams.filter(s => s.mimeType && s.mimeType.includes('mp4'));
                            if (q.includes('1080')) filtered = filtered.filter(s => s.quality && s.quality.includes('1080'));
                            else if (q.includes('720')) filtered = filtered.filter(s => s.quality && s.quality.includes('720'));
                            filtered.sort((a,b) => (parseInt(b.quality)||0) - (parseInt(a.quality)||0));
                            videoUrl = (filtered[0] || data.videoStreams[0]).url;
                        }
                        if (videoUrl) {
                            console.log(`[YT PIPED DOWNLOAD] ${videoUrl.slice(0,80)}`);
                            // Redirect to piped URL for direct download (no popup, direct)
                            return res.json({ downloadUrl: videoUrl, via: 'piped', title: data.title, direct: true });
                        }
                    } catch (e) { continue; }
                }
            } catch {}
        }
    }

    // Normal yt-dlp download for all platforms
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
        const audioQ = qLower.includes('320')? '0' : '5';
        cmd = `${base} -f "bestaudio/best" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${audioQ} "${url.replace(/"/g, '\\"')}"`;
    } else {
        cmd = `${base} -f "${format}" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
    }

    console.log(`[DOWNLOAD] ${url.slice(0,70)} | ${quality} | ${format}`);

    exec(cmd, { maxBuffer: 1024*1024*200, timeout: 180000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('[DL FAIL 1]', stderr?.slice(0,800));
            const fb1 = `${base} -f "best" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
            exec(fb1, { maxBuffer: 1024*1024*200, timeout: 180000 }, (err2) => {
                if (err2) {
                    const fb2 = `yt-dlp -f "best" -o "${outputTemplate}" "${url.replace(/"/g, '\\"')}"`;
                    exec(fb2, { maxBuffer: 1024*1024*200, timeout: 180000 }, (err3) => {
                        if (err3) return res.status(500).json({ error: 'Download failed. YouTube IP block hai, thodi der baad try karo.', details: stderr?.slice(0,800) });
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
            const ext = target.split('.').pop();
            const cleanName = `VideoDownloadHub_${Date.now()}.${ext}`;
            console.log(`[SENDING] ${target}`);
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
        const videoId = extractYTId(url);
        if (videoId) {
            const pipedInfo = await fetchYTViaPiped(videoId);
            if (pipedInfo && pipedInfo.pipedData && pipedInfo.pipedData.videoStreams) {
                const stream = pipedInfo.pipedData.videoStreams.find(s=>s.mimeType.includes('mp4')) || pipedInfo.pipedData.videoStreams[0];
                if (stream) return res.json({ downloadUrl: stream.url, via: 'piped' });
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

app.listen(PORT, ()=>console.log(`✅ Video Download Hub backend running on ${PORT} - YouTube Piped fix`));
