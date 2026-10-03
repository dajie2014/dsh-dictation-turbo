# Dictation Turbo

**双击 Control 键 = 用鼠标点一下输入框下方那个语音输入麦克风。**

- 空闲时双击 → 开始听写
- 录音中双击 → 停止（DSH 自己转写，结果落进草稿）

## 这是干什么的

DSH 自带的语音输入要用**鼠标点**那个麦克风按钮。手一直在键盘上的人，
为这一下去够鼠标很打断思路。这个插件只做一件事：**把那一下点击换成双击 Control**。

它**不自己录音、也不自己识别** —— 用的就是 DSH 官方语音输入插件的能力，
只是换了个触发方式。所以识别质量、支持哪些语言，完全取决于你的 DSH 配置，
跟本插件无关。

## 装

1. 把这个仓库放到本地任意位置，比如 `~/dsh-dictation-turbo`。

2. 编辑 `~/.dsh/profiles/desktop/package.json`，加两处：

   ```json
   {
     "dependencies": {
       "dictation-turbo": "file:/你的路径/dsh-dictation-turbo"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "dictation-turbo"
         ]
       }
     }
   }
   ```

3. 装依赖 —— ⚠️ **这一步别用默认命令**：

   ```sh
   cd ~/.dsh/profiles/desktop
   pnpm install --no-frozen-lockfile
   ```

   ⚠️ **默认的 `pnpm install` 会因为锁文件对不上，先把整个 `node_modules` 删光**，
   你装过的其它插件会一起消失。**一定要加 `--no-frozen-lockfile`。**

4. 重启 DSH。

## 用

在 DSH 窗口里**双击 Control** → 录音条出现 → 说话 → **再双击 Control** → 停止。

只要 DSH 窗口是当前窗口就响应，不要求光标停在输入框里
（录音条一展开焦点就离开输入框了，绑焦点反而会让"第二次双击"失灵）。

## ⚠️ 在哪个版本上验证过

**DSH 0.2.0-rc.2**。

## ⚠️ 它什么时候会坏

本插件靠**按钮的类名后缀**（`_triggerAnchor` / `_captureRow` / `_roundButton`）
和 **aria-label** 来定位那个麦克风 —— 也就是说，它认的是 DSH 界面的**内部长相**。

**DSH 一改界面，它就可能找不到那个按钮**，而且它**不会报错**，
表现只是「按了 Ctrl 没反应」。

真遇到这种情况，先看一眼界面左下角那行常驻的诊断小字
（会写「候选=几 锚点=几」，正常时锚点应该有 1 个）。
定位逻辑在 `client.js` 的 `micButton()` 里，三路试探：
`_triggerAnchor` → 按 aria-label 找 → `_trigger` 兜底。

## 已知限制

- **只在 DSH 窗口里有效** —— 它点的是 DSH 界面上的按钮，别的程序里没有那个按钮。
- **能听哪些语言，取决于 DSH 的语音引擎**，不是本插件能决定的。

## 许可

MIT
