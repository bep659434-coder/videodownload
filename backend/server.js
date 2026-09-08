const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Temp folder
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// 1. INFO API - video ka data nikalne ke liye
app.post('/api/info', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    // yt-dlp se info JSON me nikalo (download nahi)
    // --no-playlist, --dump-json
    const cmd = `yt-dlp --no-playlist --dump-json --no-warnings "${url}"`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        if (err) {
            console.error(stderr);
            return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr });
        }
        try {
            const info = JSON.parse(stdout);
            // frontend ko chahiye data
            const response = {
                title: info.title,
                thumbnail: info.thumbnail,
                uploader: info.uploader,
                duration: info.duration_string,
                formats: info.formats ? info.formats.map(f => ({
                    quality: f.format_note || f.height + 'p',
                    ext: f.ext,
                    filesize: f.filesize,
                    url: f.url // direct url (expires quickly)
                })).filter(f => f.ext === 'mp4').slice(-6) : [],
                best_formats: [
                    { label: 'Best Video (MP4)', quality: 'best', ext: 'mp4' },
                    { label: '1080p Full HD', quality: '1080', ext: 'mp4' },
                    { label: '720p HD', quality: '720', ext: 'mp4' },
                    { label: '480p', quality: '480', ext: 'mp4' },
                    { label: 'MP3 320kbps', quality: 'mp3-320', ext: 'mp3' },
                    { label: 'MP3 128kbps', quality: 'mp3-128', ext: 'mp3' },
                ]
            };
            res.json(response);
        } catch (e) {
            res.status(500).json({ error: 'Parse error' });
        }
    });
});

// 2. DOWNLOAD API - actual download
app.post('/api/download', (req, res) => {
    const { url, quality } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = crypto.randomBytes(8).toString('hex');
    let formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    if (quality === '1080') formatString = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]';
    if (quality === '720') formatString = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]';
    if (quality === '480') formatString = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]';
    if (quality && quality.startsWith('mp3')) formatString = 'bestaudio --extract-audio --audio-format mp3 --audio-quality 0';

    // Output file
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    
    // yt-dlp command
    let cmd = `yt-dlp -f "${formatString}" -o "${outputTemplate}" --no-playlist "${url}"`;
    if (quality && quality.startsWith('mp3')) {
        cmd = `yt-dlp -f "bestaudio" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${quality === 'mp3-320' ? '0' : '5'} --no-playlist "${url}"`;
    }

    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
        if (err) {
            console.error(stderr);
            return res.status(500).json({ error: 'Download failed', details: stderr });
        }
        // find downloaded file
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
        if (files.length === 0) return res.status(500).json({ error: 'File not found after download' });
        
        const filePath = path.join(TEMP_DIR, files[0]);
        
        // direct file download karwa do
        res.download(filePath, files[0], (err) => {
            // download ke baad delete kar do temp file
            fs.unlink(filePath, () => {});
        });
    });
});

// Simple direct streaming method (YouTube etc ke liye best)
app.get('/api/direct', async (req, res) => {
    const { url, quality } = req.query;
    // Is method me hum yt-dlp se direct stream url leke redirect kar dete hain, server storage nahi lagta
    const formatString = quality === '720' ? 'best[height<=720]' : 'best';
    const cmd = `yt-dlp -f "${formatString}" -g --no-playlist "${url}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        const directUrl = stdout.trim().split('\n')[0];
        res.json({ downloadUrl: directUrl });
    });
});


// GET version for direct link (for GitHub Pages window.location)
app.get('/api/download', (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = require('crypto').randomBytes(8).toString('hex');
    let formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080') formatString = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]';
    if (quality === '720') formatString = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]';
    if (quality === '480') formatString = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]';
    
    const path = require('path');
    const fs = require('fs');
    const outputTemplate = path.join(__dirname, 'temp', `${id}.%(ext)s`);
    let cmd = `yt-dlp -f "${formatString}" -o "${outputTemplate}" --no-playlist "${url}"`;
    if (quality && quality.startsWith('mp3')) {
        cmd = `yt-dlp -f "bestaudio" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${quality === 'mp3-320' ? '0' : '5'} --no-playlist "${url}"`;
    }

    const { exec } = require('child_process');
    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
        if (err) {
            console.error(stderr);
            return res.status(500).json({ error: 'Download failed' });
        }
        const TEMP_DIR = path.join(__dirname, 'temp');
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
        if (files.length === 0) return res.status(500).json({ error: 'File not found' });
        const filePath = path.join(TEMP_DIR, files[0]);
        res.download(filePath, files[0], () => { fs.unlink(filePath, () => {}); });
    });
});


app.listen(PORT, () => console.log(`SnapVault backend running on http://localhost:${PORT}`));
