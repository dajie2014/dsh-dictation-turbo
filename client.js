/* eslint-disable */
/**
 * dsh-ctrl-dictate — 浏览器半体。
 *
 * 它只做一件事：**双击 Control 键，代替鼠标去点输入框下方那个语音输入麦克风。**
 *
 *   · 空闲时双击 → 点击麦克风「开始听写」（等价于点一下那颗按钮）
 *   · 录音中双击 → 点击录音栏里的「停止」（等价于点停止：结束录音并转写进草稿）
 *
 * 为什么是「点按钮」而不是直接调录音接口：
 * 麦克风是官方实验插件 @deepseek-ai/dsh-experimental-client-ui-voice-input 自己的
 * 内部状态（React 本地状态 + MediaRecorder），没有对外接口。它渲染的按钮带
 * `onClick`，用 DOM 的 click() 触发与真手点同一条代码路径 —— 这是最稳定的接法，
 * 也正是 dsh-search 那个插件在用的路子（纯 DOM、无构建步骤）。
 *
 * 三个刻意的设计：
 *   1. 只在**输入框获得焦点**时响应。否则「控件键双击」会跑到应用外面去
 *      （文件对话框那种），那不是用户要的。
 *   2. 两次 Control 之间**按过别的键就不算双击** —— 避免一边打字一边误触。
 *   3. 不用按钮上的文字（中文/英文会变），只用**稳定的类名后缀**
 *      （`_trigger` / `_captureRow` / `_roundButton`）和图标名定位。
 */
window.__ModuleLoader__.load({
  id: 'dictation-turbo',
  factory: (require) => {
    const exports = {}

    /* ============================ 参数 ============================ */

    /** 两次 Control 之间的最长间隔（毫秒），超过就算两次单击。 */
    const DOUBLE_TAP_MS = 400
    /** 提示气泡停留时长。 */
    const TOAST_MS = 1800

    /* ============================ 样式 ============================ */

    const CSS = [
      // 右下角的一行小提示：不做成大弹窗，只是告诉用户「触发了什么」。
      '.cd_toast{position:fixed;right:22px;bottom:22px;z-index:1400;max-width:320px;padding:9px 14px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(32,32,34,.92));color:var(--dsw-alias-label-primary,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.28));',
      'font-size:13px;line-height:1.5;font-family:inherit;pointer-events:none;}',
      // 临时诊断条：显示「最近一次双击看见了什么」，方便远程排查（查完就删）。
      '.cd_diag{position:fixed;left:22px;bottom:22px;z-index:1400;max-width:460px;padding:8px 12px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,rgba(32,32,34,.92));color:var(--dsw-alias-label-primary,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));font-size:12px;line-height:1.55;',
      'font-family:inherit;pointer-events:none;white-space:pre-wrap;}',
    ].join('')

    /* ============================ DOM 工具 ============================ */

    const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector))

    /**
     * 麦克风按钮：class 形如 `CIpuWG_trigger`。
     * 用 `*="_trigger"` 而不是写死 `CIpuWG_` —— 那个前缀是构建时生成的哈希，会随版本变。
     */
    function micButton() {
      // ① 最准：语音输入插件把自己的按钮套在一个叫 xxx_triggerAnchor 的容器里。
      //    这个锚点是它独有的，别的插件的按钮不会用。
      for (const anchor of $$('[class*="_triggerAnchor"]')) {
        const b = anchor.querySelector('button')
        if (b && !b.closest('[role="dialog"]')) return b
      }
      // ② 兜底：按无障碍标签（中英文都认）
      for (const b of $$('button[aria-label]')) {
        const label = (b.getAttribute('aria-label') || '').trim()
        if (/^(开始听写|开始录音|语音输入|Start dictation|Start recording)$/i.test(label)) return b
      }
      // ③ 最后兜底：_trigger 里挑一个「不是菜单类」的按钮。
      //    ★ 必须排除 aria-haspopup —— 账号菜单那类按钮就是靠这个露馅的
      //    （2026-10-03 实际踩到：只按 _trigger 匹配，抓到了右上角账号菜单）。
      for (const b of $$('button[class*="_trigger"]')) {
        if (b.closest('[role="dialog"]')) continue
        if (b.hasAttribute('aria-haspopup')) continue
        return b
      }
      return null
    }

    /** 录音栏是否已经展开 —— 展开就有 `CIpuWG_captureRow` 这个容器。 */
    function recordingBar() {
      return document.querySelector('[class*="_captureRow"]')
    }

    /**
     * 录音栏里的**停止**按钮。
     *
     * ★★ 2026-10-03 找到的真凶：
     *   录音栏里有**两个**圆按钮——左边是「取消 / 丢弃」（✕），右边才是「停止」（■），
     *   两者共用同一个 `_roundButton` 样式类。
     *   原来的写法 `querySelector('button[class*="_roundButton"]')` 取到的是
     *   **第一个＝取消**，于是"再双击一次停止"实际是在**把整段录音丢掉**。
     *
     *   这解释了此前所有怪异现象：波形有声音（录音确实在进行）、没有字（被丢了）、
     *   没有报错（取消不报错）、重采样探针抓不到（取消那条路根本不走转码这一步）。
     */
    function stopButton() {
      const row = recordingBar()
      if (!row) return null
      // ① 最准：按无障碍标签认「停止」
      for (const b of Array.from(row.querySelectorAll('button'))) {
        const label = (b.getAttribute('aria-label') || '').trim()
        if (/^(停止|结束|Stop)$/i.test(label)) return b
      }
      // ② 兜底：从右往左找圆按钮，跳过「取消 / 丢弃」那种
      const rounds = Array.from(row.querySelectorAll('button[class*="_roundButton"]'))
      for (let i = rounds.length - 1; i >= 0; i--) {
        const label = (rounds[i].getAttribute('aria-label') || '').trim()
        if (!/取消|丢弃|关闭|cancel|discard|close/i.test(label)) return rounds[i]
      }
      return null
    }

    /**
     * 像真鼠标那样点一下。
     *
     * ★ 2026-10-03 的关键教训：**`el.click()` 对这种按钮无效**。
     *   真鼠标点击是「pointerdown → mousedown → pointerup → mouseup → click」
     *   一整串；而 `el.click()` 只发最后那个 `click`。
     *   界面里的 Button 是靠「按下去/抬起来」驱动 onClick 的（为了按压反馈），
     *   所以只发 click 它一律不理 —— 用户看到的现象就是「按了没反应」。
     *   实测：鼠标手点能出录音条，`el.click()` 不能。
     */
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
      const pointer = {
        ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        width: 1, height: 1, pressure: 0.5,
      }
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

    /* ============================ 提示气泡 ============================ */

    let toastEl = null
    let toastTimer = null

    function toast(text) {
      if (!toastEl) {
        toastEl = document.createElement('div')
        toastEl.className = 'cd_toast'
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
     * 诊断输出 —— **已下线**。
     * 2026-10-03 功能验证通过后关掉；留着函数是为了不再改动调用点。
     * 要重新排查时，把下面这行 return 去掉即可恢复界面上的诊断条。
     */
    function diag(text) {
      void text
      return
    }

    /* ============================ 键盘状态机 ============================ */

    let lastCtrlAt = 0
    let broken = false // 两次 Control 之间按过别的键
    let tapTimer = null

    /** 输入框有没有焦点（右键菜单/弹窗里不算）。 */
    function editorFocused() {
      const el = document.activeElement
      if (!el || el === document.body) return false
      const tag = el.tagName
      if (tag === 'TEXTAREA') return true
      if (tag === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase()
        return ['text', 'search', 'url', 'email', 'password', ''].includes(type)
      }
      return el.isContentEditable === true
    }

    function handleToggle() {
      // 诊断：先把现场情况记下来（找到几个候选、按钮能不能用）
      diag('双击已收到 | ' + snapshot())
      // 正在录音 → 停止
      if (recordingBar()) {
        const stop = stopButton()
        if (stop) {
          realClick(stop)
          toast('⏹ 已停止听写，正在转写…')
          // 转写要一点时间，等它把音频处理完再报数
          // ★ 不要再拿固定延时去裁定「有没有」：
          //   这个听写是**先录完再出字**，转写要跑几秒。
          //   之前我用停止后 2.5 秒去读探针，结果误报「没抓到音频」，
          //   把一次成功的转写判成了失败（2026-10-03 的教训）。
          setTimeout(() => {
            const r = window.__cdRec
            const a = window.__cdAudio
            const sd = window.__cdSend
            const parts = []
            parts.push('录音机=' + (!r ? '没记录' : (r.error ? r.error : (r.chunks + '块/' + Math.round(r.bytes / 1024) + 'KB'))))
            parts.push('重采样=' + (!a ? '没走到' : (a.error ? a.error : (a.seconds + '秒/峰值' + a.peakDb + 'dB'))))
            parts.push('发出=' + (!sd ? '没抓到' : (Math.round(sd.size / 1024) + 'KB@' + sd.at)))
            diag('停止后｜' + parts.join(' | ') + '　（等 8 秒再看输入框）')
          }, 4000)
          return
        }
        toast('⚠️ 没找到「停止」按钮，请手动点一下')
        return
      }
      // 空闲 → 开始
      const mic = micButton()
      if (!mic) {
        toast('⚠️ 没找到麦克风按钮（这个界面版本可能不一样）')
        return
      }
      if (mic.disabled) {
        toast('⚠️ 麦克风现在不可用（语音模型可能还没装好）')
        return
      }
      try {
        realClick(mic)
      } catch (e) {
        diag('点击时抛异常：' + e)
      }
      // 点击后分三次探测：录音栏有没有出现？（诊断用，查完删）
      const marks = []
      ;[200, 600, 1400].forEach((ms, i, arr) => {
        setTimeout(() => {
          marks.push(ms + 'ms=' + (recordingBar() ? '在' : '无'))
          if (i === arr.length - 1) diag('点击『开始录音』后 → ' + marks.join(' '))
        }, ms)
      })
      toast('🎙 已开始听写，再双击 Control 结束')
    }

    function onKeyDown(event) {
      const key = event.key
      if (key === 'Control' || key === 'ControlLeft' || key === 'ControlRight') {
        if (event.repeat) return
        // ★ 2026-10-03 修：不再要求“焦点停在输入框里”。
        //   录音栏一展开，焦点就离开输入框；原来的写法会把**第二次双击**
        //   自己挡掉，结果就是“能开、停不下来”。
        //   现在只要 DSH 窗口是前台（能收到 keydown 就说明是），双击就认。
        const now = Date.now()
        if (broken) {
          // 这一轮里按过别的键：把它当成新一轮的第一次
          broken = false
          lastCtrlAt = now
          return
        }
        if (now - lastCtrlAt <= DOUBLE_TAP_MS) {
          lastCtrlAt = 0
          if (tapTimer) {
            clearTimeout(tapTimer)
            tapTimer = null
          }
          handleToggle()
          return
        }
        lastCtrlAt = now
        if (tapTimer) clearTimeout(tapTimer)
        tapTimer = setTimeout(() => {
          lastCtrlAt = 0
          tapTimer = null
        }, DOUBLE_TAP_MS)
        return
      }
      // 别的键按下 → 打断「双击」判定（不阻止事件，正常打字）
      if (lastCtrlAt) broken = true
    }

    /* ============================ 装载 ============================ */

    /** 把现场情况汇总成一行（诊断用）。 */
    function snapshot() {
      const cands = $$('button[class*="_trigger"]')
      const mic = micButton()
      const bar = recordingBar()
      // aria-label / aria-haspopup 是判断「这个按钮现在点下去会干什么」的关键：
      //   可用时 => aria-label=「开始听写」、没有 haspopup
      //   不可用时 => aria-label=「语音输入尚未就绪」之类、haspopup=dialog（点它会弹安装引导）
      const label = mic ? (mic.getAttribute('aria-label') || '(空)') : '-'
      const popup = mic ? (mic.getAttribute('aria-haspopup') || '无') : '-'
      const dis = mic ? (mic.disabled ? '禁用' : '未禁用') : '-'
      const allLabels = cands.map((b) => b.getAttribute('aria-label') || '?').join(',')
      return '候选=' + cands.length
        + ' 锚点=' + $$('[class*="_triggerAnchor"]').length
        + ' 选中=[' + label + ']/' + dis
        + ' 弹窗=' + popup
        + ' 录音栏=' + (bar ? '在' : '不在')
        + ' 候选标签=' + allLabels
    }

    /**
     * 探针（临时诊断）：语音输入插件在录音收尾时会把音频重采样成
     * 16 kHz 单声道，那一步用 OfflineAudioContext.startRendering 完成。
     * 这里量出它的产物：多长、多响、峰值多少 dB。
     * 这样就能判断「送进识别器的到底是不是有声音的音频」。
     */
    /**
     * 更靠前的一层探针：盯住录音机本身。
     * 看它到底收没收到音频块、每块多大、录了多久。
     * （上一版只盯了「重采样」那一步，结果什么都没抓到 —— 说明录音机这一环就没出数据。）
     */
    function installRecorderProbe() {
      if (window.__cdRecProbe) return
      window.__cdRecProbe = true
      const Orig = window.MediaRecorder
      if (!Orig) {
        window.__cdRec = { error: '这个环境没有 MediaRecorder' }
        return
      }
      function Patched(...args) {
        const rec = new Orig(...args)
        const info = { chunks: 0, bytes: 0, mime: '', ms: 0, events: 0 }
        window.__cdRec = info
        try { info.mime = rec.mimeType || '(未报)' } catch (e) { /* 忽略 */ }
        rec.addEventListener('dataavailable', (ev) => {
          info.events++
          const size = (ev.data && ev.data.size) || 0
          if (size > 0) { info.chunks++; info.bytes += size }
        })
        const t0 = Date.now()
        const origStop = rec.stop.bind(rec)
        rec.stop = function () {
          info.ms = Date.now() - t0
          return origStop()
        }
        return rec
      }
      Patched.prototype = Orig.prototype
      if (Orig.isTypeSupported) Patched.isTypeSupported = Orig.isTypeSupported.bind(Orig)
      window.MediaRecorder = Patched
    }

    /**
     * 最外层的探针：盯住页面往外发的数据（音频要送到宿主去识别）。
     * 只看大包（> 2 KB），记下大小和时间 —— 这样能判定「录音到底有没有发出去」。
     * WebSocket 和 fetch 两条路都盯。
     */
    function installSendProbe() {
      if (window.__cdSendProbe) return
      window.__cdSendProbe = true
      const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
      const note = (size, kind) => {
        if (size > 2000) window.__cdSend = { size: size, kind: kind, at: stamp() }
      }
      try {
        const WS = window.WebSocket
        if (WS && WS.prototype && typeof WS.prototype.send === 'function') {
          const origSend = WS.prototype.send
          WS.prototype.send = function (data) {
            try {
              const size = typeof data === 'string'
                ? data.length
                : ((data && data.byteLength) || (data && data.size) || 0)
              note(size, typeof data === 'string' ? 'WebSocket文本' : 'WebSocket二进制')
            } catch (e) { /* 忽略 */ }
            return origSend.call(this, data)
          }
        }
      } catch (e) { /* 忽略 */ }
      try {
        const origFetch = window.fetch
        if (typeof origFetch === 'function') {
          window.fetch = function (...args) {
            try {
              const body = args[1] && args[1].body
              const size = body
                ? (body.byteLength || body.size || String(body).length)
                : 0
              note(size, 'fetch')
            } catch (e) { /* 忽略 */ }
            return origFetch.apply(this, args)
          }
        }
      } catch (e) { /* 忽略 */ }
    }

    function installAudioProbe() {
      if (window.__cdAudioProbe) return
      window.__cdAudioProbe = true
      installRecorderProbe()
      const proto = (window.OfflineAudioContext || window.webkitOfflineAudioContext || {}).prototype
      if (!proto || typeof proto.startRendering !== 'function') {
        window.__cdAudio = { error: '这个环境没有 OfflineAudioContext' }
        return
      }
      const orig = proto.startRendering
      proto.startRendering = async function (...args) {
        const buffer = await orig.apply(this, args)
        try {
          const data = buffer.getChannelData(0)
          let peak = 0
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i])
            if (v > peak) peak = v
          }
          window.__cdAudio = {
            samples: data.length,
            seconds: (data.length / buffer.sampleRate).toFixed(2),
            rate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
            peakDb: (20 * Math.log10(peak || 1e-8)).toFixed(1),
          }
        } catch (e) {
          window.__cdAudio = { error: String(e) }
        }
        return buffer
      }
    }

    function start() {
      const styleEl = document.createElement('style')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      // 探针已下线（功能已验证）。需要排查时把下面两行放回来。
      // installAudioProbe()
      // installSendProbe()

      // 装载时自动报一次（临时诊断：确认插件到没到、按钮认不认得）。
      // 1.5 秒是等界面把麦克风按钮渲染出来；一次性定时器，不是轮询。
      setTimeout(() => {
        try { diag('插件已加载 v3 | ' + snapshot()) } catch (e) { /* 诊断失败不影响主功能 */ }
      }, 1500)

      // 捕获阶段监听：即使焦点在编辑器里，事件也会先经过 window。
      window.addEventListener('keydown', onKeyDown, true)

      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        if (tapTimer) clearTimeout(tapTimer)
        if (toastTimer) clearTimeout(toastTimer)
        if (toastEl) toastEl.remove()
        toastEl = null
        styleEl.remove()
      }
    }

    exports.name = 'dictation-turbo'
    exports.inject = []
    exports.apply = (ctx) => {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => start(), 'dsh-ctrl-dictate: 双击 Control 听写')
      } else {
        start()
      }
    }

    return exports
  },
})
