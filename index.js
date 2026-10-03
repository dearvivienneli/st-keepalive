// 酒馆保活 KeepAlive
// 原理：循环播放一段 2 分钟的静音音频，让 iOS Safari 认为页面正在播放媒体，从而不挂起后台标签页。
// 音频在内存里现场生成，不需要额外的音频文件。

const STORAGE_KEY = 'st_keepalive_enabled';
const LOOP_SECONDS = 120;   // 循环长度：2 分钟
const SAMPLE_RATE = 8000;   // 低采样率，2 分钟静音约 0.9 MB

let audio = null;
let audioUrl = null;
let gestureArmed = false;
let userStopped = false;

function isEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}
function setEnabled(value) {
    try { localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false'); } catch { /* ignore */ }
}

// 生成一段静音 WAV（8 位单声道，128 即为静音）
function makeSilentWavUrl(seconds) {
    const samples = SAMPLE_RATE * seconds;
    const buffer = new ArrayBuffer(44 + samples);
    const view = new DataView(buffer);
    const writeString = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt 块长度
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // 单声道
    view.setUint32(24, SAMPLE_RATE, true); // 采样率
    view.setUint32(28, SAMPLE_RATE, true); // 字节率
    view.setUint16(32, 1, true);           // 块对齐
    view.setUint16(34, 8, true);           // 8 位
    writeString(36, 'data');
    view.setUint32(40, samples, true);
    new Uint8Array(buffer, 44).fill(128);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function setStatus(state) {
    const dot = document.getElementById('st_keepalive_dot');
    const text = document.getElementById('st_keepalive_state');
    if (!dot || !text) return;
    dot.classList.remove('on', 'wait');
    if (state === 'running') { dot.classList.add('on'); text.textContent = '运行中'; }
    else if (state === 'waiting') { dot.classList.add('wait'); text.textContent = '等待你点一下页面'; }
    else { text.textContent = '未开启'; }
}

function ensureAudio() {
    if (audio) return audio;
    audioUrl = makeSilentWavUrl(LOOP_SECONDS);
    audio = document.createElement('audio');
    audio.src = audioUrl;
    audio.loop = true;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);

    audio.addEventListener('playing', () => setStatus('running'));
    // 被系统打断（来电、其他 App 放音乐等）后，自动尝试恢复
    audio.addEventListener('pause', () => {
        if (isEnabled() && !userStopped) setTimeout(tryPlay, 1500);
    });
    setupMediaSession();
    return audio;
}

function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: '酒馆保活中', artist: 'SillyTavern' });
        navigator.mediaSession.setActionHandler('play', () => { userStopped = false; tryPlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { stop(); });
    } catch { /* 某些浏览器不支持，忽略 */ }
}

function tryPlay() {
    if (!isEnabled()) return;
    const el = ensureAudio();
    if (!el.paused) { setStatus('running'); return; }
    el.play()
        .then(() => setStatus('running'))
        .catch(() => { setStatus('waiting'); armGesture(); });
}

// iOS 规定：音频必须由一次真实的点击启动
function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    const handler = () => {
        gestureArmed = false;
        document.removeEventListener('touchend', handler, true);
        document.removeEventListener('pointerdown', handler, true);
        tryPlay();
    };
    document.addEventListener('touchend', handler, true);
    document.addEventListener('pointerdown', handler, true);
}

function stop() {
    userStopped = true;
    if (audio) audio.pause();
    setStatus('off');
}

function start() {
    userStopped = false;
    tryPlay();
}

function buildSettingsUi() {
    const html = `
    <div class="st-keepalive-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>酒馆保活</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input type="checkbox" id="st_keepalive_toggle">
                    <span>开启后台保活</span>
                </label>
                <div class="st-keepalive-status">
                    <span id="st_keepalive_dot" class="st-keepalive-dot"></span>状态：<span id="st_keepalive_state">未开启</span>
                </div>
                <small>开启后，如果状态显示"等待你点一下页面"，在酒馆里随便点一下就会开始运行（iOS 的规定，必须由点击启动）。以后每次重新打开酒馆，也需要先点一下页面。</small>
            </div>
        </div>
    </div>`;
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', html);

    const toggle = document.getElementById('st_keepalive_toggle');
    toggle.checked = isEnabled();
    toggle.addEventListener('change', () => {
        setEnabled(toggle.checked);
        if (toggle.checked) start(); else stop();
    });
}

function init() {
    buildSettingsUi();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isEnabled() && !userStopped) tryPlay();
    });
    if (isEnabled()) tryPlay();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
