# Dictation Turbo

**双击 Control 说话，文字直接落进输入框 —— 说中文、说英文、说德语，都不用切输入法。**

给 DSH（DeepSeek Harness）用：在它的窗口里，用说的代替打字。

> ### 不装 VoiceStudio 也能用
>
> **中文和英文是自带的。** 只要 DSH 装着、开着，它就能听这两种话 ——
> 不需要再装任何别的东西。
>
> VoiceStudio 只是**多加的一只耳朵**，专门用来听德语（以及另外 600 多种语言）。
> **用不上德语的人，不用装它，功能一样完整。**

**中文** · [English](#dictation-turbo-english)

---

## 为什么值得用

### 1. 不用切输入法

说中文、说德语、说英文，**不必在输入法之间来回切**（不用 ⌘空格 去翻那个语言）。
语音直接就变成文字了 —— 这条路**根本不经过输入法**。

混着说几种语言的人感觉最明显：一句中文、一句德语，中间**没有任何切换动作**。

### 2. 说哪种语言，它自己判断

两只耳朵同时待命：

| 你说的 | 谁来听 | 为什么 |
|---|---|---|
| **中文 / 英文** | DSH 自带的识别（SenseVoice） | **不用装任何东西**；中文更准：简体、全角标点 |
| 德语及另外 600 多种（**可选**） | 本机 VoiceStudio | DSH 那个模型没学过德语；**要德语才需要它** |

分工是自动的：先把音频交给 VoiceStudio（它自带语言检测），听出来是**中文**，
就换 DSH 再听一遍；任何一边没接上，另一边顶上。**没有"选语言"这个动作。**

> **再强调一次：VoiceStudio 是可选件，不是前提。** 没装它，中文和英文照样用，
> 只是德语等长尾语言走不通 —— 就这么点区别，别的什么都不缺。

### 3. 靠听写输入的人（包括看不见屏幕的人）

操作被压到**只剩一个动作**：

- **双击 Control** → 开始说（一声轻提示音）
- **再双击 Control** → 结束，文字落进输入框（又一声轻提示音）

不用看屏幕找按钮、不用鼠标、**也不用先把光标点进输入框** ——
"去点那个麦克风"本来是最不适合看不见的人的一步。
状态全靠声音：**响一声开录、响一声结束**，没听清是另一个音高。

---

## 用

| 动作 | 结果 |
|---|---|
| 双击 Control | 开始录音（右下角出现红点 + 秒数 + 音量条） |
| 再双击 Control | 结束、识别、文字落进输入框 |
| **Option + 双击 Control** | **自检**：把该查的查一遍（输入框认不认得、两只耳朵通不通） |

**太安静就不送识别**：全程没声音时它会说"没听到声音"，
而不是硬猜一句莫名其妙的话出来 —— 这是"听写很糟"的一大来源。

## 装

1. 把这个仓库放到本地任意位置，例如 `~/dsh-dictation-turbo`

2. 编辑 `~/.dsh/profiles/desktop/package.json`，加两处：

   ```json
   {
     "dependencies": {
       "dictation-turbo": "file:/你的路径/dsh-dictation-turbo"
     },
     "dsh": {
       "profile": {
         "bundles": ["dictation-turbo"]
       }
     }
   }
   ```

3. 装依赖 —— ⚠️ **必须带 `--no-frozen-lockfile`**：

   ```sh
   cd ~/.dsh/profiles/desktop
   pnpm install --no-frozen-lockfile
   ```

   ⚠️ 默认的 `pnpm install` 会因为锁文件对不上，**先把整个 `node_modules` 删光**，
   你装过的其它插件会一起消失。

4. 重启 DSH。之后改 `client.js` 只要**刷新页面（⌘R）**就生效。

### 只有想要德语的人，才需要这一步

**上面四步做完，中文和英文就已经能用了** —— 打开 DSH，双击 Control 说句话就成，
不用再配任何东西。下面这一小段是**可选**的。

VoiceStudio 是个本机服务（默认 `http://127.0.0.1:3900`）。要跨源访问它，
得让它的允许来源里有 **`dsh-app://app`** —— 这是 DSH 页面的真实来源
（**Electron 的私有协议，不是浏览器地址栏上那个地址**；写地址栏那个没有用）。

## 它跟 DSH 官方语音输入的关系

官方那套是"**点界面上的麦克风按钮**"，识别用 DSH 自己的引擎。

本插件**自己录音、自己选引擎、自己把字落进输入框**，
所以才能做官方做不到的那件事：**同一句话，按语言自动换引擎**。
（也因此它不依赖界面上的按钮长什么样，DSH 改版不容易把它弄坏。）

想在**任何程序**里听写（不只是 DSH 窗口），那是另一个形态的版本。

## 已知限制

- **只在 DSH 窗口里有效**。
- **DSH 必须开着** —— 识别引擎住在它里面。
- **中文 / 英文只要 DSH 就够了**；德语另需 VoiceStudio 也在跑（**可选，不装不影响中英文**）。
- 本插件自己不带模型，**能听哪些语言取决于上面这两个引擎**。

## 许可

MIT · 作者 Jie Da

---
---

# Dictation Turbo (English)

**Double-tap Control and speak — the words land in the input box. Chinese, English or German, with no input-method switching.**

A plugin for DSH (DeepSeek Harness): dictate instead of typing in its window.

> ### VoiceStudio is not required
>
> **Chinese and English are built in.** With DSH installed and running, it hears both —
> there is nothing else to install.
>
> VoiceStudio is only a **second ear**, there for German (and 600+ other languages).
> **If you do not need German, skip it — nothing else is missing.**

**English** · [中文](#dictation-turbo)

---

## Why it is worth using

### 1. No input-method switching

Speak Chinese, German or English — you never switch input methods (no ⌘Space dance).
Speech becomes text directly; this path never goes through an IME at all.

It shows most clearly if you mix languages: one sentence in Chinese, the next in German, with no switching action in between.

### 2. It works out the language itself

Two ears listen at the same time:

| You speak | Who listens | Why |
|---|---|---|
| **Chinese / English** | DSH's built-in recognizer (SenseVoice) | **Nothing to install**; better Chinese: simplified characters, full-width punctuation |
| German and 600+ other languages (**optional**) | Local VoiceStudio | DSH's model never learned German; **only needed for German** |

The split is automatic: the audio goes to VoiceStudio first (it detects the language itself); if it comes back as Chinese, DSH listens again; if either side is unavailable, the other takes over. There is no "pick a language" step.

> **Again: VoiceStudio is an optional extra, not a prerequisite.** Without it, Chinese
> and English work exactly the same — the only thing you lose is German and other
> long-tail languages. Nothing else is missing.

### 3. Built for people who dictate — including people who cannot see the screen

The whole interaction is reduced to one gesture:

- **Double-tap Control** → start speaking (a soft click)
- **Double-tap Control again** → stop; the text lands in the input box (another soft click)

No hunting for a button on screen, no mouse, and no need to click into the input box first — "go click that microphone" is exactly the step that is worst for someone who cannot see it.
State is carried by sound: one beep starts recording, one beep ends it, and a different pitch means something needs your attention.

---

## Usage

| Action | Result |
|---|---|
| Double-tap Control | Start recording (red dot + timer + level meter in the bottom-right corner) |
| Double-tap Control again | Stop, recognize, insert the text into the input box |
| **Option + double-tap Control** | **Self-check**: verifies the input box is reachable and both recognizers answer |

**Silence is never sent to the recognizer**: if nothing was heard, it says so instead of guessing a random sentence — one of the main sources of "dictation is terrible".

## Installation

1. Put this repository anywhere on your machine, e.g. `~/dsh-dictation-turbo`

2. Edit `~/.dsh/profiles/desktop/package.json` and add two things:

   ```json
   {
     "dependencies": {
       "dictation-turbo": "file:/your/path/dsh-dictation-turbo"
     },
     "dsh": {
       "profile": {
         "bundles": ["dictation-turbo"]
       }
     }
   }
   ```

3. Install dependencies — ⚠️ **`--no-frozen-lockfile` is required**:

   ```sh
   cd ~/.dsh/profiles/desktop
   pnpm install --no-frozen-lockfile
   ```

   ⚠️ A plain `pnpm install` hits a lockfile mismatch and **wipes the entire `node_modules` first**, taking every other plugin you installed down with it.

4. Restart DSH. After that, edits to `client.js` need only a **page refresh (⌘R)**.

### Only needed if you want German

**After the four steps above, Chinese and English already work** — open DSH, double-tap Control and speak. Nothing else to configure. The rest of this section is **optional**.

VoiceStudio is a local service (default `http://127.0.0.1:3900`). To reach it across origins, add **`dsh-app://app`** to its allowed origins — that is the real origin of the DSH page (**an Electron private protocol, not the address in the browser bar**; the one in the address bar will not work).

## How it relates to DSH's built-in voice input

The built-in feature is "click the microphone button in the UI", and recognition uses DSH's own engine.

This plugin records by itself, picks the engine itself and inserts the text itself — which is what makes possible the thing the built-in one cannot do: **the same sentence, with the engine chosen by language**.
(It also does not depend on what the UI button looks like, so DSH redesigns are unlikely to break it.)

If you want to dictate in **any application** (not just the DSH window), that is a different build.

## Known limitations

- **Works only inside the DSH window.**
- **DSH must be running** — the recognition engines live inside it.
- **Chinese / English need only DSH**; German also needs VoiceStudio running (**optional — skipping it costs you nothing in Chinese or English**).
- The plugin ships no model of its own; **which languages you can use depends on those two engines**.

## License

MIT · by Jie Da
