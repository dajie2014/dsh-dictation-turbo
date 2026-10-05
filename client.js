/* eslint-disable */
/**
 * dsh-ctrl-dictate — 浏览器半体（v4：双引擎）
 *
 * **双击 Control 说话，文字落进输入框。**
 *
 *   · 空闲时双击 → 开始录音（右下角出现一条小提示：红点 + 秒数 + 电平）
 *   · 录音中双击 → 结束、识别、把字落进输入框
 *   · Option + 双击 → 只测「落字」这一段（不录音），用来排查"识别对了但字没进去"
 *
 * 两只耳朵：
 *   · 中英 → DSH 自己的 SenseVoice（简体、全角标点，中文更准）
 *   · 德语及其余长尾 → VoiceStudio（本机 3900，646 种语言）
 *   怎么分工：先让 VoiceStudio 听（它自带语言检测），听出来是中文就换 DSH 重听一遍。
 *   为什么不能反过来：SenseVoice 不认识德语时**不报错**，而是硬猜成中文或英文。
 *
 * 与前几版的关系：
 *   v3 只是"替鼠标去点官方的麦克风按钮"，引擎是官方那一个（SenseVoice，只认 5 种语言）。
 *   v4 自己录、自己选引擎、自己落字 —— 所以德语才走得通。
 *   官方那条路仍留着：如果官方录音条正在录，双击会去点它的「停止」（免得卡住）。
 */

window.__ModuleLoader__.load({
  id: 'dictation-turbo',
  factory: (require) => {
    const exports = {}

    /* ============================ 参数 ============================ */

    /** 两次 Control 之间的最长间隔（毫秒），超过就算两次单击。 */
    const DOUBLE_TAP_MS = 400
    /** 提示气泡停留时长。 */
    const TOAST_MS = 2600
    /** 最短录音：比这短当误触丢掉。 */
    const MIN_SECONDS = 0.35
    /** 全程最响都没到这个音量，就不送识别（静音送进去一定会被硬猜出东西）。 */
    const MIN_PEAK = 0.02
    /** 最长录这么久强制收工（秒）。 */
    const MAX_SECONDS = 120
    /** 送识别一律 16 kHz 单声道 —— DSH 那个接口只收这种。 */
    const RATE = 16000
    /** VoiceStudio 本机地址。 */
    const VS_BASE = 'http://127.0.0.1:3900'
    /** 要不要让 VoiceStudio 用本地大模型润色（更通顺，但要多等几秒）。 */
    const VS_REFINE = false

    /* ============================ 样式 ============================ */

    const CSS = [
      // 右下角提示气泡
      '.dt_toast{position:fixed;right:22px;bottom:22px;z-index:1400;max-width:340px;padding:9px 14px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(32,32,34,.92));color:var(--dsw-alias-label-primary,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.28));',
      'font-size:13px;line-height:1.5;font-family:inherit;pointer-events:none;}',
      // 录音中那条：红点 + 秒数 + 电平
      '.dt_rec{position:fixed;right:22px;bottom:22px;z-index:1400;display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(32,32,34,.94));color:var(--dsw-alias-label-primary,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.28));',
      'font-size:13px;font-family:inherit;pointer-events:none;}',
      '.dt_dot{width:9px;height:9px;border-radius:50%;background:#ff4d4f;animation:dt_blink 1s ease-in-out infinite;}',
      '@keyframes dt_blink{0%,100%{opacity:1}50%{opacity:.25}}',
      '.dt_time{font-variant-numeric:tabular-nums;min-width:38px;}',
      '.dt_meter{width:70px;height:6px;border-radius:3px;background:rgba(255,255,255,.16);overflow:hidden;}',
      '.dt_meter>i{display:block;height:100%;width:0%;background:#4ade80;transition:width .08s linear;}',
      '.dt_hint{opacity:.7;font-size:12px;}',
      // 诊断条（开发期用；查完关掉 diag() 里那行 return 即可）
      '.dt_diag{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:1500;max-width:min(780px,94vw);padding:8px 12px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(32,32,34,.92));color:var(--dsw-alias-label-primary,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));font-size:12px;line-height:1.55;',
      'font-family:inherit;pointer-events:none;white-space:pre-wrap;}',
    ].join('')

    /* ============================ 小工具 ============================ */

    const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector))

    /** 毫秒 → 0:03 这种样子 */
    function clock(ms) {
      const s = Math.floor(ms / 1000)
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
    }

    /** 字节 → base64（分块，不然一次展开几百万个参数会爆栈） */
    function toBase64(bytes) {
      let out = ''
      const CH = 0x8000
      for (let i = 0; i < bytes.length; i += CH) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
      }
      return btoa(out)
    }

    /* ============================ 提示 ============================ */

    let toastEl = null
    let toastTimer = null

    function toast(text) {
      if (!toastEl) {
        toastEl = document.createElement('div')
        toastEl.className = 'dt_toast'
        document.body.appendChild(toastEl)
      }
      toastEl.textContent = text
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.remove()
        toastEl = null
        toastTimer = null
      }, TOAST_MS)
    }

    /**
     * 轻提示音。为什么要有：靠听写输入的人（尤其看不见屏幕的）没法盯着右下角那条小字，
     * 得靠声音知道"开始录了 / 结束了 / 没成"。
     *
     * 三个音的音高是定死的，**和 Mac 全系统版那三个完全一致**（两个版本听起来才是同一个东西）：
     *   开始 C6(1046.5) ／ 结束 C5(523.25) —— 同一个音名、低一个八度，不用比较就能分；
     *   不顺 F#5(740) —— 对 C 调来说是个三全音，听着就"不对劲"。
     *
     * 另外两处是按实测改的（2026-10-05，用户反馈"有一个比较微弱、吵一点就不好辨认"）：
     *   ① 音量 0.06 → 0.22 —— 原来太轻，这是"微弱"的主要来源；
     *   ② 纯正弦 → 基音 + 两个泛音、响 0.30 秒 —— 纯正弦太单薄，小喇叭上一散就没。
     */
    function chime(kind) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        const ac = new AC()
        const base = kind === 'start' ? 1046.5 : (kind === 'ok' ? 523.25 : 739.99)
        const out = ac.createGain()
        out.connect(ac.destination)
        const t0 = ac.currentTime
        // 结束那个是低八度（C5），人耳对低频不敏感 —— 同样电平听起来就是轻一档。
        // 所以它单独给更大的音量、稍长的尾巴（用户反馈：「低的 C 再大声一些」）。
        const VOL = kind === 'ok' ? 0.32 : 0.22
        const DUR = kind === 'ok' ? 0.35 : 0.30
        // 基音 + 八度泛音 + 十二度泛音：比纯正弦"实"，更像一声"叮"
        for (const [mult, amp] of [[1, 1.0], [2, 0.30], [3, 0.12]]) {
          const osc = ac.createOscillator()
          const g = ac.createGain()
          osc.type = 'sine'
          osc.frequency.value = base * mult
          g.gain.value = amp
          osc.connect(g)
          g.connect(out)
          osc.start(t0)
          osc.stop(t0 + DUR)
        }
        out.gain.setValueAtTime(VOL, t0)
        out.gain.exponentialRampToValueAtTime(0.0004, t0 + DUR)
        setTimeout(() => { try { ac.close() } catch (e) { /* 忽略 */ } }, 700)
      } catch (e) { /* 忽略 */ }
    }

    let diagEl = null
    let diagLines = []
    let diagHideTimer = null
    /** 诊断条：**累积**最近几条 —— 截图一次就能看到连着试的几下，而不只是最后一次。 */
    function diag(text) {
      if (!diagEl) {
        diagEl = document.createElement('div')
        diagEl.className = 'dt_diag'
        document.body.appendChild(diagEl)
      }
      const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      diagLines.push(stamp + '  ' + text)
      if (diagLines.length > 10) diagLines = diagLines.slice(-10)
      diagEl.textContent = diagLines.join('\n')
      // 说完了就自己走开：日常不该有一行字常驻在屏幕顶上
      if (diagHideTimer) clearTimeout(diagHideTimer)
      diagHideTimer = setTimeout(() => {
        if (diagEl) diagEl.remove()
        diagEl = null
        diagLines = []
      }, 20000)
    }

    /* ============================ 录音条 ============================ */

    let recEl = null
    let recTimer = null
    let recMeter = null

    function showRecBar() {
      hideRecBar()
      recEl = document.createElement('div')
      recEl.className = 'dt_rec'
      recEl.innerHTML = '<span class="dt_dot"></span><span class="dt_time">0:00</span>'
        + '<span class="dt_meter"><i></i></span><span class="dt_hint">再双击 Control 结束</span>'
      document.body.appendChild(recEl)
      recMeter = recEl.querySelector('i')
    }

    function hideRecBar() {
      if (recTimer) { clearInterval(recTimer); recTimer = null }
      if (recEl) { recEl.remove(); recEl = null }
      recMeter = null
    }

    /* ============================ 录音 ============================ */

    let live = null // { rec, stream, chunks, t0, analyser, raf, peak }

    function canRecord() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)
    }

    async function beginRecording() {
      if (live) return
      if (!canRecord()) { toast('⚠️ 这个环境不支持录音'); return }
      // 先响再开录：这一声要是被自己录进去，偶尔会被识别成莫名其妙的字
      chime('start')
      await sleep(180)
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // autoGainControl 关掉：它会把小声放大到贴顶（诊断里的"峰值 1.00"就是这么来的），
          // 削波会伤识别。全系统版没这个处理，录出来的峰值一直很温和。
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        })
      } catch (e) {
        toast('⚠️ 拿不到麦克风：' + (e && e.message ? e.message : e))
        return
      }
      const chunks = []
      let rec
      try {
        rec = new MediaRecorder(stream)
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop())
        toast('⚠️ 录音机起不来：' + (e && e.message ? e.message : e))
        return
      }
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data) }
      rec.start(200)

      // 电平：让"到底有没有声音"变成看得见的一件事
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      const src = ac.createMediaStreamSource(stream)
      const analyser = ac.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)

      live = { rec, stream, chunks, t0: Date.now(), ac, analyser, peak: 0 }
      showRecBar()

      recTimer = setInterval(() => {
        if (!live) return
        const ms = Date.now() - live.t0
        const timeEl = recEl && recEl.querySelector('.dt_time')
        if (timeEl) timeEl.textContent = clock(ms)
        try {
          live.analyser.getFloatTimeDomainData(buf)
          let p = 0
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i])
            if (v > p) p = v
          }
          if (p > live.peak) live.peak = p
          if (recMeter) recMeter.style.width = Math.min(100, Math.round(p * 140)) + '%'
        } catch (e) { /* 忽略 */ }
        if (ms > MAX_SECONDS * 1000) stopRecording() // 忘了关就自动收工
      }, 100)
    }

    async function stopRecording() {
      if (!live) return
      const { rec, stream, chunks, t0, ac, peak } = live
      live = null
      const blob = await new Promise((resolve) => {
        try {
          rec.onstop = () => resolve(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' }))
          rec.stop()
          // 万一 onstop 不来，别把用户卡住
          setTimeout(() => resolve(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' })), 1500)
        } catch (e) {
          resolve(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' }))
        }
      })
      stream.getTracks().forEach((t) => t.stop())
      try { await ac.close() } catch (e) { /* 忽略 */ }
      hideRecBar()

      const seconds = (Date.now() - t0) / 1000
      if (seconds < MIN_SECONDS || !blob.size) {
        diag('录得太短（' + seconds.toFixed(2) + ' 秒），当误触丢掉')
        return
      }
      if (peak < MIN_PEAK) {
        // 静音/只有底噪时别送识别 —— 送进去一定会被硬猜出一句莫名其妙的话
        diag('没听到声音（峰值 ' + peak.toFixed(3) + '），跳过识别')
        toast('🔇 没听到声音，没说就没送识别')
        return
      }
      toast('⏳ 正在识别…')
      diag('录音 ' + seconds.toFixed(1) + ' 秒 / 峰值 ' + peak.toFixed(2) + '　正在识别…')
      await transcribeAndInsert(blob, seconds, peak)
    }

    /* ============================ 音频 → 16k 单声道 WAV ============================ */

    /** 浏览器录的是 webm/opus，先解码，再重采样到 16 kHz 单声道，最后手写 RIFF 头。 */
    async function toWav(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = new AC()
      let decoded
      try {
        decoded = await ac.decodeAudioData(bytes.buffer.slice(0))
      } finally {
        try { await ac.close() } catch (e) { /* 忽略 */ }
      }
      const frames = Math.max(1, Math.ceil(decoded.duration * RATE))
      const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, frames, RATE)
      const src = off.createBufferSource()
      src.buffer = decoded
      src.connect(off.destination)
      src.start()
      const rendered = await off.startRendering()
      const f32 = rendered.getChannelData(0)

      // Float32 → PCM16
      const pcm = new Uint8Array(f32.length * 2)
      let k = 0
      for (let i = 0; i < f32.length; i++) {
        let s = f32[i]
        if (s > 1) s = 1; else if (s < -1) s = -1
        const v = s < 0 ? s * 0x8000 : s * 0x7fff
        const n = v | 0
        pcm[k++] = n & 0xff
        pcm[k++] = (n >> 8) & 0xff
      }

      // 只有 RIFF + fmt + data 三个块。
      // 为什么不用现成工具转：那些会塞 LIST/FLLR 之类的附加块，DSH 的接口会直接拒收。
      const head = new Uint8Array(44)
      const dv = new DataView(head.buffer)
      const put = (at, str) => { for (let i = 0; i < str.length; i++) head[at + i] = str.charCodeAt(i) }
      put(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length, true); put(8, 'WAVE')
      put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
      dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
      put(36, 'data'); dv.setUint32(40, pcm.length, true)

      const wav = new Uint8Array(head.length + pcm.length)
      wav.set(head, 0)
      wav.set(pcm, head.length)
      return wav
    }

    /* ============================ 两只耳朵 ============================ */

    /** DSH 自己的识别（SenseVoice）。跟页面同源，直接发，不用管跨域。 */
    async function askDSH(wav) {
      const body = {
        type: 'client-request',
        rpcId: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
        method: 'speech/transcribe',
        payload: { args: { request: { audioBase64: toBase64(wav) } } },
      }
      const res = await fetch('/api/speech/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const env = await res.json()
      if (env && env.result && env.result.ok && env.result.value) {
        return { text: String(env.result.value.text || '') }
      }
      const e = env && env.result && env.result.error
      throw new Error('DSH：' + (e ? (e.code + ' ' + e.message) : ('HTTP ' + res.status)))
    }

    /** VoiceStudio（本机 3900）。它自带语言检测，德语就在这条路上。 */
    async function askVoiceStudio(wav) {
      const form = new FormData()
      form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'a.wav')
      form.append('mode', 'fast')
      form.append('dictation', 'true') // 用他保存的听写词表（专有名词更准）
      if (VS_REFINE) form.append('refine', 'true')
      const res = await fetch(VS_BASE + '/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error('VoiceStudio：HTTP ' + res.status)
      const obj = await res.json()
      return { text: String(obj.text || ''), lang: obj.language || '', engine: obj.engine || '' }
    }

    /** 含汉字的比例够高就算说的是中文（跟全系统版同一套判据）。 */
    function looksChinese(text) {
      let han = 0
      let letters = 0
      for (const ch of text) {
        const c = ch.codePointAt(0)
        if (c >= 0x4e00 && c <= 0x9fff) han++
        if (/\p{L}/u.test(ch)) letters++
      }
      if (!letters) return false
      return han / letters > 0.4
    }

    /** 先 VoiceStudio 探语言：中文 → 换 DSH 重听；其他 → 就用 VoiceStudio。 */
    async function route(wav) {
      const notes = []
      let vs = null
      try {
        vs = await askVoiceStudio(wav)
      } catch (e) {
        notes.push('VoiceStudio: ' + (e && e.message ? e.message : e))
      }
      const vsText = vs && vs.text ? vs.text.trim() : ''
      if (!vsText) notes.push(vs ? 'VoiceStudio 听出空结果' : 'VoiceStudio 没接上')
      if (vsText && looksChinese(vsText)) {
        try {
          const d = await askDSH(wav)
          const t = (d.text || '').trim()
          if (t) return { text: t, who: 'DSH', notes }
        } catch (e) {
          notes.push('DSH: ' + (e && e.message ? e.message : e))
        }
        return { text: vsText, who: 'VoiceStudio（DSH 没接上）', lang: vs.lang, notes }
      }
      if (vsText) return { text: vsText, who: 'VoiceStudio', lang: vs.lang, notes }
      // VoiceStudio 没开或没结果 → 全交给 DSH
      try {
        const d = await askDSH(wav)
        return { text: (d.text || '').trim(), who: 'DSH', notes }
      } catch (e) {
        notes.push('DSH: ' + (e && e.message ? e.message : e))
        throw new Error(notes.join(' ｜ '))
      }
    }

    /* ============================ 把字落进输入框 ============================ */

    /** 找输入框：可见、够大、不在弹窗里的 textarea / 可编辑区，取最靠下的那个。 */
    function composerEl() {
      // 最准：焦点本来就在输入框里（我们自录音，不会像官方那样把焦点带走）
      const act = document.activeElement
      if (act && act !== document.body && !act.closest('[role="dialog"]')) {
        const tag = act.tagName
        if (tag === 'TEXTAREA') return act
        if (tag === 'INPUT') {
          const t = (act.getAttribute('type') || 'text').toLowerCase()
          if (['text', 'search', 'url', 'email', 'password', ''].includes(t)) return act
        }
        if (act.isContentEditable === true) return act
      }
      const cands = [
        ...$$('textarea'),
        ...$$('[contenteditable="true"]'),
        ...$$('[role="textbox"]'),
      ].filter((el) => {
        if (el.closest('[role="dialog"]')) return false
        const r = el.getBoundingClientRect()
        if (r.width < 120 || r.height < 12) return false
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') return false
        return true
      })
      cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)
      return cands[0] || null
    }

    function readValue(el) {
      if (!el) return ''
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || ''
      return el.textContent || ''
    }

    /**
     * 落字。三条路依次试，谁成算谁：
     *   ① 编辑命令 insertText —— 最通用（textarea 和可编辑区都认），走的是浏览器原生编辑，
     *      界面框架能收到正常的输入事件，中文/德语都不会被输入法截走。
     *   ② 直接改值 —— 给受控输入框用：调原型上的 setter 绕开框架的"值追踪"，再手动派发 input。
     *   ③ 复制到剪贴板 —— 前两条都不行时兜底，告诉他按一次 ⌘V。
     */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    /** 把光标放到编辑区末尾 —— 选区不在这个框里，编辑命令会作用到别处（等于没插）。 */
    function caretToEnd(el) {
      try {
        if (!(el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return
        el.focus()
        const sel = window.getSelection()
        if (!sel) return
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      } catch (e) { /* 忽略 */ }
    }

    async function insertText(text) {
      const el = composerEl()
      if (!el) return { ok: false, how: '没找到输入框' }
      caretToEnd(el)
      const before = readValue(el)

      // ① 编辑命令：textarea 与可编辑区都认，走的是浏览器原生编辑
      try { document.execCommand('insertText', false, text) } catch (e) { /* 换下一条 */ }
      await sleep(40)
      if (readValue(el) !== before) return { ok: true, how: '编辑命令', el }

      // ② 伪造一次粘贴：富文本编辑器基本都监听 paste —— 比硬改 DOM 更"正"
      try {
        const dt = new DataTransfer()
        dt.setData('text/plain', text)
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
      } catch (e) { /* 换下一条 */ }
      await sleep(90)
      if (readValue(el) !== before) return { ok: true, how: '粘贴事件', el }

      // ③ 直接改值（普通受控输入框）：调原型上的 setter 绕开框架的值追踪，再派发 input
      try {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
          setter.call(el, before + text)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          await sleep(40)
          if (readValue(el) !== before) return { ok: true, how: '直接改值', el }
        }
      } catch (e) { /* 换下一条 */ }

      // ④ 剪贴板兜底：至少别让这句话白说
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
          return { ok: false, how: '已复制到剪贴板（按 ⌘V 贴上）' }
        }
      } catch (e) { /* 忽略 */ }
      return { ok: false, how: '四条路都没成' }
    }

    /* ============================ 自检（排查用） ============================ */

    /**
     * 一次把该看的都看一遍：输入框认不认得、落字走哪条路、VoiceStudio 通不通、DSH 通不通。
     * 为什么 VoiceStudio 分三层测：网络不通 / 通了但被跨源规则挡 / 通了但接口不吃这个请求
     * —— 三种毛病三种修法，不分开测就只能瞎猜。
     */
    async function selfCheck(withInsert) {
      const out = []
      const el = composerEl()
      out.push('输入框=' + (el
        ? el.tagName + (el.isContentEditable ? '/可编辑' : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '')
        : '没找到'))
      out.push('地址=' + location.origin + '｜浏览器=' + ((String(navigator.userAgent).match(/(Chrome|Electron)\/[\d.]+/g) || []).join(' ')))
      out.push('落字=' + (withInsert ? (await insertText('这是落字测试，一二三四五。')).how : '（未测）'))

      // VoiceStudio：直接打真接口，发一段故意不合法的音频。
      // 判据是"能不能拿到 HTTP 状态码" —— 400/500 都算通（网络与跨源都过了，只是音频不合法）。
      // ⚠️ 别拿首页 HTML 去测跨源：那个响应不带跨源头，会误报成"被挡"（2026-10-03 踩过）。
      try {
        const form = new FormData()
        form.append('audio', new Blob([new Uint8Array([0, 0])], { type: 'audio/wav' }), 'x.wav')
        form.append('mode', 'fast')
        const r = await fetch(VS_BASE + '/transcribe', { method: 'POST', body: form })
        out.push('VS=通（HTTP ' + r.status + (r.status === 200 ? '）' : '；非 200 是因为自检发的是假音频）'))
      } catch (e) {
        out.push('VS=被挡（' + (e && e.message ? e.message : e) + '）')
      }
      // ④ DSH
      try {
        const r = await fetch('/api/speech/catalog', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request', rpcId: String(Date.now()),
            method: 'speech/catalog', payload: { args: {} },
          }),
        })
        const env = await r.json()
        out.push('DSH=' + (env && env.result && env.result.ok ? '通' : '异常 HTTP ' + r.status))
      } catch (e) {
        out.push('DSH=失败（' + (e && e.message ? e.message : e) + '）')
      }
      diag(out.join('\n'))
    }

    /* ============================ 主流程 ============================ */

    async function transcribeAndInsert(blob, seconds, peak) {
      let wav
      try {
        wav = await toWav(blob)
      } catch (e) {
        diag('音频转码失败：' + e)
        toast('⚠️ 音频转码失败')
        return
      }
      const t0 = Date.now()
      let out
      try {
        out = await route(wav)
      } catch (e) {
        chime('low')
        diag('识别失败：' + e)
        toast('⚠️ 没接上引擎（' + (e && e.message ? e.message : e) + '）')
        return
      }
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      const text = (out.text || '').trim()
      if (!text) {
        chime('low')
        diag('引擎没听出字（' + out.who + '，' + dt + ' 秒）')
        toast('🤔 没听出内容')
        return
      }
      const put = await insertText(text)
      chime(put.ok ? 'ok' : 'low')
      diag('录 ' + seconds.toFixed(1) + ' 秒/峰值 ' + peak.toFixed(2)
        + ' | [' + out.who + (out.lang ? ' ' + out.lang : '') + '] ' + dt + ' 秒'
        + (peak > 0.97 ? '（音量可能爆了）' : '')
        + ' | 落字=' + put.how
        + (out.notes && out.notes.length ? ' | 旁注=' + out.notes.join('；') : '')
        + '\n    ' + text.slice(0, 100))
      toast(put.ok
        ? '✅ ' + out.who + '　' + dt + ' 秒'
        : '⚠️ ' + put.how)
    }

    /* ============================ 官方那条路（保留兜底） ============================ */

    function realClick(el) {
      if (!el) return
      try { el.scrollIntoView({ block: 'nearest' }) } catch (e) { /* 忽略 */ }
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const base = {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, detail: 1,
      }
      const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0.5 }
      const fire = (target, type, init) => {
        const isPointer = type.startsWith('pointer')
        const Ctor = isPointer ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent
        target.dispatchEvent(new Ctor(type, init))
      }
      fire(el, 'pointerover', { ...pointer, buttons: 0, pressure: 0 })
      fire(el, 'pointerenter', { ...pointer, buttons: 0, pressure: 0, bubbles: false })
      fire(el, 'pointerdown', { ...pointer, buttons: 1 })
      fire(el, 'mousedown', { ...base, buttons: 1 })
      fire(el, 'pointerup', { ...pointer, buttons: 0, pressure: 0 })
      fire(el, 'mouseup', { ...base, buttons: 0 })
      fire(el, 'click', { ...base, buttons: 0 })
    }

    /** 官方录音条在不在（它一展开就有这个容器）。 */
    function recordingBar() {
      return document.querySelector('[class*="_captureRow"]')
    }

    /** 官方录音条里那个「停止」（最右边那个圆按钮，别拿成左边的取消）。 */
    function stopButton() {
      const row = recordingBar()
      if (!row) return null
      for (const b of Array.from(row.querySelectorAll('button'))) {
        const label = (b.getAttribute('aria-label') || '').trim()
        if (/^(停止|结束|Stop)$/i.test(label)) return b
      }
      const rounds = Array.from(row.querySelectorAll('button[class*="_roundButton"]'))
      for (let i = rounds.length - 1; i >= 0; i--) {
        const label = (rounds[i].getAttribute('aria-label') || '').trim()
        if (!/取消|丢弃|关闭|cancel|discard|close/i.test(label)) return rounds[i]
      }
      return null
    }

    /* ============================ 键盘状态机 ============================ */

    let lastCtrlAt = 0
    let broken = false
    let tapTimer = null
    let altPending = false

    function handleToggle(alt) {
      // Option + 双击 = 只测落字，不录音
      if (alt) {
        toast('🔧 自检中…')
        selfCheck(true)
        return
      }
      // 官方录音条正开着 → 帮他停掉（不然两边都在录，他也不知道该按哪）
      if (recordingBar()) {
        const stop = stopButton()
        if (stop) { realClick(stop); toast('⏹ 已停止官方录音，正在转写…'); return }
      }
      if (live) stopRecording()
      else beginRecording()
    }

    function onKeyDown(event) {
      const key = event.key
      if (key === 'Control' || key === 'ControlLeft' || key === 'ControlRight') {
        if (event.repeat) return
        const now = Date.now()
        if (broken) { broken = false; lastCtrlAt = now; altPending = event.altKey; return }
        if (now - lastCtrlAt <= DOUBLE_TAP_MS) {
          lastCtrlAt = 0
          if (tapTimer) { clearTimeout(tapTimer); tapTimer = null }
          handleToggle(altPending && event.altKey)
          altPending = false
          return
        }
        lastCtrlAt = now
        altPending = event.altKey
        if (tapTimer) clearTimeout(tapTimer)
        tapTimer = setTimeout(() => { lastCtrlAt = 0; tapTimer = null }, DOUBLE_TAP_MS)
        return
      }
      if (lastCtrlAt) broken = true
    }

    /* ============================ 装载 ============================ */

    function start() {
      const styleEl = document.createElement('style')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      window.addEventListener('keydown', onKeyDown, true)
      // 装载时报一次现场：输入框认得哪个、录音设备在不在
      setTimeout(() => {
        diag('dictation-turbo v4 就绪｜麦克风=' + (canRecord() ? '可用' : '不可用'))
        selfCheck(false)
      }, 1500)
      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        if (tapTimer) clearTimeout(tapTimer)
        if (toastTimer) clearTimeout(toastTimer)
        if (toastEl) toastEl.remove()
        if (diagEl) diagEl.remove()
        hideRecBar()
        toastEl = null
        diagEl = null
        styleEl.remove()
      }
    }

    exports.name = 'dictation-turbo'
    exports.inject = []
    exports.apply = (ctx) => {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => start(), 'dictation-turbo: 双击 Control 听写（双引擎）')
      } else {
        start()
      }
    }

    return exports
  },
})
