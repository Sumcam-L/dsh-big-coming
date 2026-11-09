// dsh-big-coming — browser half.
//
// Two surfaces:
//   * `settings.section` — the control panel (Key, interval, base URL, watch
//     list, immediate probe, rebaseline, history, presentation).
//   * `shell.overlay` — the comedy: when the Host reports a fingerprint change
//     the newest event is thrown on screen as a wobbling meme with the change
//     list underneath.
//
// All network and disk work stays in the Host half; this module only calls
// `/dsh-big-coming/api` and renders.

window.__ModuleLoader__.load({
  id: 'dsh-big-coming',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'big-coming'
    const API = '/dsh-big-coming/api'
    const EVENT_NAME = 'dsh-big-coming:changed'
    const SEEN_KEY = 'dsh-big-coming.seen-event'
    const POLL_MS = 20000
    const AUTO_CLOSE_MS = 24000
    // Rows shown before the card has to collapse; the badge appears past this.
    const COLLAPSED_ROWS = 3

    const zh = {
      'nav.label': '大的要来了',
      'section.title': '大的要来了',
      'section.desc': '定时用最小请求探测官方模型的系统指纹，变了就弹一张表情包。',
      'key.title': 'API Key',
      'key.configured': '已配置',
      'key.missing': '未配置',
      'key.placeholder': 'sk-... 粘贴官方 API Key',
      'key.save': '保存',
      'key.clear': '清除',
      'key.hint': '保存后只显示掩码。Key 写入 DSH 凭据存储（无凭据服务时退回插件私有文件）。',
      'key.empty': 'Key 不能为空',
      'key.saved': 'Key 已保存',
      'key.cleared': 'Key 已清除',
      'probe.title': '探测',
      'probe.interval': '探测间隔',
      'probe.minutes': '分钟（最小 1）',
      'probe.presets': '常用',
      'probe.auto': '自动探测',
      'probe.baseUrl': '接口地址',
      'probe.watch': '只盯这几个模型',
      'probe.watchHint': '留空表示探测目录里的全部模型，每轮最多 4 个；用逗号分隔。',
      'probe.cost': '每轮消耗 {perCycle} token（{models} 个模型）；按当前间隔每天 {perDay}、每月 {perMonth}。',
      'probe.costNote': '只发一次极小的请求：思考已关闭，回复只要 1 个 token；读取模型目录不计费。',
      'probe.now': '立即探测',
      'probe.rebaseline': '重新校准基线',
      'probe.probing': '探测中…',
      'probe.demo': '看一次样子',
      'probe.demoHint': '放一次假变更，只看动效和音效，不写基线也不记历史。',
      'probe.unchanged': '没有变化，世界和平。',
      'probe.baselineSet': '基线已建立',
      'look.title': '动效与音效',
      'look.motion': '动效',
      'look.motionAdaptive': '跟随系统',
      'look.motionFull': '全开',
      'look.motionOff': '关闭',
      'look.motionHint': '「跟随系统」在系统开启减少动效时只保留淡入淡出；「全开」不受系统设置影响。',
      'look.sound': '音效',
      'look.volume': '音量',
      'look.test': '听一下',
      'look.muted': '音效当前是关闭的，先打开开关再试。',
      'look.audioFail': '播放失败：浏览器拦截了音频，或声卡不可用。再点一次通常就好了。',
      'look.hint': '弹窗出现时放一段核爆轰鸣（3.4 秒，公共领域素材）。浏览器禁止在用户操作前播放声音，所以第一次可能静音，点一下页面即可。',
      'status.title': '状态',
      'status.baseline': '基线时间',
      'status.checks': '探测次数',
      'status.changes': '发现变更',
      'status.lastCheck': '上次探测',
      'status.lastError': '最近错误',
      'status.models': '基线模型',
      'status.fingerprints': '系统指纹',
      'status.none': '还没有',
      'status.file': '状态文件',
      'popup.kicker': 'DETECTED',
      'popup.title': '大的要来了',
      'popup.subtitle': '官方模型发生变化',
      'popup.details': '变化明细',
      'popup.close': '我知道了我准备好了',
      'popup.more': '展开全部',
      'popup.count': '共 {n} 项',
      'popup.countHint': '这次共检测到 {n} 项变化，默认只显示前 3 项',
      'popup.less': '收起',
      'popup.soundOn': '音效：开',
      'popup.soundOff': '音效：关',
      'history.title': '最近变更',
      'history.empty': '还没有变更记录',
      'common.hour': '小时',
      'common.minutesShort': '{n} 分钟',
      'common.hoursShort': '{n} 小时',
      'common.failed': '操作失败',
    }

    const en = {
      'nav.label': 'Big news incoming',
      'section.title': 'Big news incoming',
      'section.desc': 'Probes the official model system fingerprint with the cheapest possible request and pops a meme when it moves.',
      'key.title': 'API key',
      'key.configured': 'Configured',
      'key.missing': 'Not configured',
      'key.placeholder': 'sk-... paste the official API key',
      'key.save': 'Save',
      'key.clear': 'Clear',
      'key.hint': 'Only a masked hint is shown after saving. The key goes into DSH credential storage, with a private file fallback.',
      'key.empty': 'The key cannot be empty',
      'key.saved': 'Key saved',
      'key.cleared': 'Key cleared',
      'probe.title': 'Probe',
      'probe.interval': 'Probe interval',
      'probe.minutes': 'minutes (min 1)',
      'probe.presets': 'Presets',
      'probe.auto': 'Automatic probe',
      'probe.baseUrl': 'API base URL',
      'probe.watch': 'Only watch these models',
      'probe.watchHint': 'Leave empty to probe every model in the catalog, at most four per cycle. Comma separated.',
      'probe.cost': 'Each cycle costs {perCycle} tokens ({models} models); {perDay} per day and {perMonth} per month at the current interval.',
      'probe.costNote': 'One tiny request per model: thinking is disabled and the reply is capped at a single token. Reading the model catalog is free.',
      'probe.now': 'Probe now',
      'probe.rebaseline': 'Recalibrate baseline',
      'probe.probing': 'Probing…',
      'probe.demo': 'Preview once',
      'probe.demoHint': 'Plays a fake change for the animation and sound only; it touches neither the baseline nor the history.',
      'probe.unchanged': 'Nothing changed. Peace.',
      'probe.baselineSet': 'Baseline established',
      'look.title': 'Motion and sound',
      'look.motion': 'Motion',
      'look.motionAdaptive': 'Follow system',
      'look.motionFull': 'On',
      'look.motionOff': 'Off',
      'look.motionHint': '"Follow system" fades the card in and out when the OS asks for reduced motion; "On" ignores the OS setting.',
      'look.sound': 'Sound',
      'look.volume': 'Volume',
      'look.test': 'Play it',
      'look.muted': 'Sound is off. Turn the switch on first.',
      'look.audioFail': 'Playback failed: the browser blocked audio or no output device is available. Pressing again usually works.',
      'look.hint': 'A 3.4-second nuclear blast (public-domain sample) plays when the popup lands. Browsers block sound before a user gesture, so the first one may be silent until you click the page.',
      'status.title': 'Status',
      'status.baseline': 'Baseline at',
      'status.checks': 'Probes',
      'status.changes': 'Changes',
      'status.lastCheck': 'Last probe',
      'status.lastError': 'Last error',
      'status.models': 'Baseline models',
      'status.fingerprints': 'System fingerprints',
      'status.none': 'None yet',
      'status.file': 'State file',
      'popup.kicker': 'DETECTED',
      'popup.title': 'Big news incoming',
      'popup.subtitle': 'The official model changed',
      'popup.details': 'What changed',
      'popup.close': 'Fine. I am ready.',
      'popup.more': 'Show all',
      'popup.count': '{n} total',
      'popup.countHint': '{n} changes detected; only the first 3 are shown',
      'popup.less': 'Collapse',
      'popup.soundOn': 'Sound: on',
      'popup.soundOff': 'Sound: off',
      'history.title': 'Recent changes',
      'history.empty': 'No change recorded yet',
      'common.hour': 'h',
      'common.minutesShort': '{n} min',
      'common.hoursShort': '{n} h',
      'common.failed': 'Failed',
    }

    // ------------------------------------------------------------------
    // Sound
    // ------------------------------------------------------------------
    //
    // One sampled cue ("the big one") plus a few tiny synthesized ones. The
    // sampled blast is decoded once and kept as an AudioBuffer; playing it
    // again reuses the buffer instead of refetching.
    //
    // Two rules keep this from becoming noise:
    //   1. A cue never overlaps itself — starting one stops the previous
    //      instance, so a burst of renders cannot machine-gun the speaker.
    //   2. Every caller passes a reason; an unchanged cue+reason inside a short
    //      window is ignored, which absorbs React's double-invoked effects.

    let audioContext = null
    let audioBroken = false
    let blastBuffer = null
    let blastLoading = null
    let activeSource = null
    // Every cue that names a reason is played once per reason. A time window
    // would let a slow render or a settings tweak replay the blast; an id set
    // cannot.
    const playedReasons = new Set()

    function getAudio() {
      if (audioBroken) return null
      if (audioContext !== null) return audioContext
      const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext || window.webkitAudioContext)
      if (typeof Ctor !== 'function') {
        audioBroken = true
        return null
      }
      try {
        audioContext = new Ctor()
        return audioContext
      } catch (error) {
        audioBroken = true
        return null
      }
    }

    /**
     * Browsers start an AudioContext suspended until a gesture. Called directly
     * from a click handler so the gesture is still "live" — awaiting a fetch
     * first would lose it.
     */
    function unlockAudio() {
      const ctx = getAudio()
      if (ctx === null) return false
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        // resume() must be called synchronously inside the gesture.
        ctx.resume().catch(() => undefined)
      }
      // Kick the decode off now: the click is the user's consent, and the
      // buffer is what the button needs a moment later.
      void loadBlast(ctx)
      return true
    }

    function loadBlast(ctx) {
      if (blastBuffer !== null) return Promise.resolve(blastBuffer)
      if (blastLoading !== null) return blastLoading
      blastLoading = fetch(API + '?action=sound', { cache: 'force-cache', credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.arrayBuffer()
        })
        .then((bytes) => new Promise((resolve, reject) => {
          // Safari's callback form takes precedence when present.
          const done = (buffer) => resolve(buffer)
          const failed = (error) => reject(error || new Error('decode failed'))
          const maybe = ctx.decodeAudioData(bytes, done, failed)
          if (maybe && typeof maybe.then === 'function') maybe.then(done, failed)
        }))
        .then((buffer) => {
          blastBuffer = buffer
          blastLoading = null
          return buffer
        })
        .catch((error) => {
          blastLoading = null
          console.warn('[dsh-big-coming] 音效加载失败：', error)
          return null
        })
      return blastLoading
    }

    /** Stops whatever this plugin is currently playing. */
    function stopSound() {
      if (activeSource === null) return
      try {
        activeSource.stop()
      } catch {
        /* already ended */
      }
      activeSource = null
    }

    function tone(ctx, spec) {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = spec.type || 'sine'
      osc.frequency.setValueAtTime(spec.from, now + spec.start)
      if (typeof spec.to === 'number' && spec.to !== spec.from) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), now + spec.start + spec.duration)
      }
      env.gain.setValueAtTime(0.0001, now + spec.start)
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.gain), now + spec.start + 0.012)
      env.gain.exponentialRampToValueAtTime(0.0001, now + spec.start + spec.duration)
      osc.connect(env)
      env.connect(ctx.destination)
      osc.start(now + spec.start)
      osc.stop(now + spec.start + spec.duration + 0.04)
    }

    /** Starts an AudioBuffer as the single active source. */
    function startBuffer(ctx, buffer, level) {
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      gain.gain.setValueAtTime(level, ctx.currentTime)
      source.connect(gain)
      gain.connect(ctx.destination)
      source.addEventListener('ended', () => {
        if (activeSource === source) activeSource = null
      })
      activeSource = source
      source.start(ctx.currentTime)
    }

    /**
     * Plays one cue.
     *
     * `reason` is a guard for the *automatic* cues: a popup event id, so a
     * re-render cannot replay the blast. A manual trigger (the settings page's
     * "listen" button) must be exempt — the user pressing the button twice
     * means they want to hear it twice — so it passes `null` here and the
     * caller manages its own behaviour.
     */
    function playCue(cue, volume, reason) {
      const ctx = getAudio()
      if (ctx === null) return false
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => undefined)
      }
      const master = Math.min(1, Math.max(0, Number(volume)))
      if (!(master > 0)) return false

      const key = cue + ':' + (reason || '')
      if (reason && playedReasons.has(key)) return false
      if (reason) {
        playedReasons.add(key)
        // A session is long-lived; keep the guard bounded.
        if (playedReasons.size > 200) {
          const oldest = playedReasons.values().next().value
          playedReasons.delete(oldest)
        }
      }

      if (cue === 'blast') {
        // Everything else yields to the blast.
        stopSound()
        if (blastBuffer !== null) {
          startBuffer(ctx, blastBuffer, master)
        } else {
          void loadBlast(ctx).then((buffer) => {
            if (buffer !== null) startBuffer(ctx, buffer, master)
            else tone(ctx, { type: 'sine', from: 220, to: 38, start: 0, duration: 0.9, gain: master * 0.5 })
          })
        }
        return true
      }

      const level = master * 0.26
      try {
        if (cue === 'tick') {
          tone(ctx, { type: 'sine', from: 1500, to: 1480, start: 0, duration: 0.06, gain: level * 0.2 })
          return true
        }
        if (cue === 'test') {
          stopSound()
          if (blastBuffer !== null) {
            startBuffer(ctx, blastBuffer, master)
            return true
          }
          // First press: decode now, then play the real sample. The silent
          // window is short and the caller is told it succeeded.
          void loadBlast(ctx).then((buffer) => {
            if (buffer !== null) startBuffer(ctx, buffer, master)
          })
          return true
        }
        return false
      } catch {
        return false
      }
    }

    // ------------------------------------------------------------------
    // Styling
    // ------------------------------------------------------------------
    //
    // Colours are literal on purpose. The theme is not one token set: the host
    // defines `--dsw-alias-*` and a skin (dsh-claude-style) redefines the same
    // names under its own attribute selectors. A control that asks for a token
    // the active theme lacks — or that inherits a label token from the same
    // family as its background — can end up invisible. Filled surfaces
    // therefore state both their background and their ink, and the dark palette
    // is matched through `data-ds-dark-theme`, which every theme in play sets.
    //
    // Layout and neutral surfaces (cards, inputs, dividers) still read the
    // theme tokens, because those are the ones a theme reliably provides; every
    // *accent* colour is spelled out.

    const CSS = [
      '@keyframes bgcFadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes bgcSheen{0%{transform:translateX(-120%) skewX(-18deg)}100%{transform:translateX(320%) skewX(-18deg)}}',
      '@keyframes bgcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}',
      '@keyframes bgcFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',

      '.bgc-root{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);-webkit-font-smoothing:antialiased}',
      '.bgc-section{display:flex;flex-direction:column;gap:16px;max-width:780px;padding:2px 0 32px}',
      '.bgc-lead{margin:0 0 2px;color:var(--dsw-alias-label-secondary);font-size:12.5px;letter-spacing:.01em}',

      '.bgc-card{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;display:flex;flex-direction:column;gap:13px;box-shadow:0 1px 2px rgba(16,24,40,.04);animation:bgcFadeUp .3s ease both}',
      '.bgc-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.bgc-cardTitle{margin:0;font-size:13px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px}',
      '.bgc-cardTitle::before{content:"";width:3px;height:13px;border-radius:2px;background:linear-gradient(180deg,#60a5fa,#2563eb);flex:0 0 auto}',
      '.bgc-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
      '.bgc-rowLabel{min-width:112px;flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.bgc-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65}',
      '.bgc-mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:12px;word-break:break-all}',

      '.bgc-input{height:34px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#d8dbe2);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);padding:0 11px;font:inherit;font-size:13px;outline:0;min-width:0;box-sizing:border-box;transition:border-color .16s ease,box-shadow .16s ease,background-color .16s ease}',
      '.bgc-input::placeholder{color:var(--dsw-alias-label-caption,#9aa3b2);opacity:1}',
      '.bgc-input:hover{border-color:var(--dsw-alias-border-l3,#c3c8d2)}',
      '.bgc-input:focus{border-color:#2563eb;box-shadow:0 0 0 3.5px rgba(37,99,235,.16);background:var(--dsw-alias-bg-base,#fff)}',
      '.bgc-inputWide{flex:1 1 280px}',
      '.bgc-inputNarrow{width:104px;text-align:center;font-variant-numeric:tabular-nums}',

      '.bgc-btn{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 15px;border-radius:9px;font:inherit;font-size:13px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;box-sizing:border-box;',
      '  border:1px solid #d5d9e0;background:#f4f5f7;color:#101828;',
      '  transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .1s ease,box-shadow .15s ease}',
      '.bgc-btn:hover:not(:disabled){background:#e9ebef;border-color:#c2c8d2;box-shadow:0 1px 2px rgba(16,24,40,.07)}',
      '.bgc-btn:active:not(:disabled){transform:translateY(.5px) scale(.985)}',
      '.bgc-btn:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
      '.bgc-btn:disabled{opacity:.42;cursor:not-allowed;box-shadow:none}',
      '.bgc-btnIcon{font-size:13px;line-height:1;display:inline-block}',

      '.bgc-btnPrimary{border-color:transparent;background:linear-gradient(180deg,#2f6fe4,#1d4ed8);color:#fff;font-weight:600;box-shadow:0 1px 2px rgba(37,99,235,.28),inset 0 1px 0 rgba(255,255,255,.22)}',
      '.bgc-btnPrimary:hover:not(:disabled){background:linear-gradient(180deg,#2f74ea,#1d4ed8);color:#fff;box-shadow:0 3px 10px rgba(37,99,235,.32),inset 0 1px 0 rgba(255,255,255,.2)}',
      '.bgc-btnPrimary::after{content:"";position:absolute;top:0;bottom:0;left:0;width:38%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.34),transparent);opacity:0}',
      '.bgc-btnPrimary:hover:not(:disabled)::after{opacity:1;animation:bgcSheen .72s ease}',

      '.bgc-btnDanger{border-color:rgba(220,38,38,.42);background:transparent;color:#dc2626}',
      '.bgc-btnDanger:hover:not(:disabled){background:rgba(220,38,38,.09);border-color:#dc2626}',

      '.bgc-btnGhost{border-color:transparent;background:transparent;color:#667085}',
      '.bgc-btnGhost:hover:not(:disabled){background:rgba(102,112,133,.12);color:#101828;box-shadow:none}',

      '.bgc-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:500;border:1px solid transparent;letter-spacing:.01em}',
      '.bgc-pillOk{color:#067647;background:rgba(18,183,106,.1);border-color:rgba(18,183,106,.28)}',
      '.bgc-pillBad{color:#b54708;background:rgba(247,144,9,.11);border-color:rgba(247,144,9,.3)}',
      '.bgc-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto;box-shadow:0 0 0 3px rgba(18,183,106,.16);animation:bgcPulse 2.1s ease-in-out infinite}',

      '.bgc-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:9px}',
      '.bgc-stat{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:11px 13px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-alias-bg-base);min-width:0;transition:border-color .16s ease,transform .16s ease}',
      '.bgc-stat:hover{border-color:var(--dsw-alias-border-l3,#c3c8d2);transform:translateY(-1px)}',
      '.bgc-statKey{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}',
      '.bgc-statVal{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary);word-break:break-word;font-variant-numeric:tabular-nums}',

      '.bgc-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);font-size:12.5px}',
      '.bgc-switch input[type="checkbox"]{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:38px;height:21px;border-radius:999px;background-color:#cbd2dc;position:relative;cursor:pointer;margin:0;flex:0 0 auto;border:0;padding:0;outline:0;transition:background-color .2s ease}',
      '.bgc-switch input[type="checkbox"]:checked{background-color:#2563eb}',
      '.bgc-switch input[type="checkbox"]:hover{background-color:#bcc4d0}',
      '.bgc-switch input[type="checkbox"]:checked:hover{background-color:#1d4ed8}',
      '.bgc-switch input[type="checkbox"]:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
      '.bgc-switch input[type="checkbox"]::after{content:"";position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background-color:#fff;box-shadow:0 1px 3px rgba(16,24,40,.28);transition:transform .2s cubic-bezier(.4,1.3,.5,1)}',
      '.bgc-switch input[type="checkbox"]:checked::after{transform:translateX(17px)}',

      '.bgc-seg{display:inline-flex;padding:2px;gap:2px;border:1px solid var(--dsw-alias-border-l2,#d8dbe2);border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}',
      '.bgc-segBtn{appearance:none;border:0;background:transparent;color:#667085;font:inherit;font-size:12px;font-weight:500;padding:0 12px;height:27px;border-radius:7px;cursor:pointer;transition:background-color .16s ease,color .16s ease,box-shadow .16s ease}',
      '.bgc-segBtn:hover{background:rgba(102,112,133,.12);color:#101828}',
      '.bgc-segBtn[data-on="true"]{background:linear-gradient(180deg,#2f6fe4,#1d4ed8);color:#fff;font-weight:600;box-shadow:0 1px 3px rgba(37,99,235,.34)}',

      '.bgc-presets{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;width:100%;overflow-x:auto;padding:1px 0;scrollbar-width:none}',
      '.bgc-presets::-webkit-scrollbar{display:none}',
      '.bgc-presetsLabel{flex:0 0 auto;margin-right:2px;font-size:11.5px;color:#667085}',
      '.bgc-preset{flex:0 0 auto;height:27px;padding:0 11px;font-size:12px;font-variant-numeric:tabular-nums}',
      ':is(html,body)[data-ds-dark-theme] .bgc-presetsLabel{color:#98a2b3}',

      '.bgc-range{width:158px;height:20px;accent-color:#2563eb;cursor:pointer}',

      '.bgc-history{display:flex;flex-direction:column;gap:8px;max-height:250px;overflow:auto;padding-right:2px}',
      '.bgc-historyItem{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-alias-bg-base);transition:border-color .16s ease,transform .16s ease}',
      '.bgc-historyItem:hover{border-color:var(--dsw-alias-border-l3,#c3c8d2);transform:translateX(2px)}',
      '.bgc-historyTop{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px}',
      '.bgc-historyHead{font-weight:640;color:var(--dsw-alias-label-primary)}',
      '.bgc-historyTime{color:var(--dsw-alias-label-secondary);font-size:11.5px;flex:0 0 auto;font-variant-numeric:tabular-nums}',

      /* ---------------- popup ---------------- */

      '.bgc-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:none;background:transparent}',
      '.bgc-flash{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.95),rgba(147,197,253,.34) 34%,rgba(255,255,255,0) 66%);animation:bgcFlash .78s ease-out forwards}',
      '@keyframes bgcFlash{0%{opacity:0}9%{opacity:1}100%{opacity:0}}',
      '.bgc-shake{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;animation:bgcScreenShake .66s cubic-bezier(.36,.07,.19,.97) both}',
      '@keyframes bgcScreenShake{0%,100%{transform:translate(0,0)}8%{transform:translate(-12px,5px) rotate(-.6deg)}17%{transform:translate(11px,-7px) rotate(.7deg)}26%{transform:translate(-9px,-4px) rotate(-.5deg)}36%{transform:translate(8px,6px) rotate(.45deg)}46%{transform:translate(-6px,3px) rotate(-.35deg)}57%{transform:translate(5px,-3px) rotate(.25deg)}68%{transform:translate(-4px,2px) rotate(-.18deg)}79%{transform:translate(2px,-1px)}90%{transform:translate(-1px,1px)}}',

      '.bgc-pop{position:relative;pointer-events:auto;width:min(444px,93vw);max-height:89vh;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:#fff;color:#101828;border:1px solid rgba(16,24,40,.09);box-shadow:0 32px 80px -12px rgba(16,24,40,.42),0 0 0 1px rgba(255,255,255,.6) inset,0 0 0 4px rgba(59,130,246,.16)}',
      '.bgc-popIn{animation:bgcDropIn .72s cubic-bezier(.16,1.5,.4,1) both,bgcWiggle 3s ease-in-out .72s infinite}',
      '@keyframes bgcDropIn{0%{opacity:0;transform:translateY(-118vh) rotate(-18deg) scale(.55)}52%{opacity:1;transform:translateY(16px) rotate(4.5deg) scale(1.045)}70%{transform:translateY(-9px) rotate(-2.8deg) scale(.988)}85%{transform:translateY(5px) rotate(1.3deg) scale(1.004)}100%{opacity:1;transform:none}}',
      '@keyframes bgcWiggle{0%,100%{transform:rotate(-.6deg)}22%{transform:rotate(.75deg) translateY(-2.5px)}52%{transform:rotate(-.45deg) translateY(1.5px)}76%{transform:rotate(.4deg)}}',
      '.bgc-popOut{animation:bgcFlyOut .48s cubic-bezier(.6,0,.9,.35) both !important}',
      '@keyframes bgcFlyOut{0%{opacity:1;transform:none}100%{opacity:0;transform:translateY(52vh) rotate(26deg) scale(.62)}}',

      '.bgc-head{position:relative;display:flex;align-items:center;gap:10px;padding:14px 16px 15px;overflow:hidden;color:#fff;background:linear-gradient(105deg,#172f8a,#1d4ed8 42%,#2160d8 74%,#2f6fe4)}',
      '.bgc-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,rgba(255,255,255,.85),rgba(255,255,255,.1))}',
      '.bgc-rays{position:absolute;inset:-50%;pointer-events:none;opacity:.5;background:repeating-conic-gradient(from 0deg,rgba(255,255,255,.3) 0deg 5deg,rgba(255,255,255,0) 5deg 13deg);animation:bgcSpin 11s linear infinite}',
      '@keyframes bgcSpin{to{transform:rotate(360deg)}}',
      '.bgc-headGlow{position:absolute;top:-60%;left:-12%;width:78%;height:230%;pointer-events:none;background:radial-gradient(ellipse at 30% 50%,rgba(255,255,255,.4),transparent 62%);animation:bgcFloat 5.5s ease-in-out infinite}',
      '.bgc-headText{position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;line-height:1.2}',
      '.bgc-kicker{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;font-size:9.5px;font-weight:800;letter-spacing:.19em;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.19);border:1px solid rgba(255,255,255,.34);margin-bottom:2px}',
      '.bgc-kickerDot{width:5px;height:5px;border-radius:50%;background:#fff;animation:bgcPulse 1.5s ease-in-out infinite}',
      '.bgc-headTitle{font-size:21px;font-weight:900;letter-spacing:.03em;text-shadow:0 2px 0 rgba(0,0,0,.26),0 6px 18px rgba(0,0,0,.22);animation:bgcJitter 1.9s steps(2,end) infinite}',
      '@keyframes bgcJitter{0%,100%{transform:translate(0,0)}24%{transform:translate(-1px,1px)}52%{transform:translate(1.2px,-1px)}76%{transform:translate(-1px,.4px)}}',
      '.bgc-headSub{font-size:11px;opacity:.92;letter-spacing:.03em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bgc-sparkles{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
      '.bgc-sparkle{position:absolute;font-size:14px;color:#fff;opacity:0;animation:bgcSparkle 2.9s ease-in-out infinite}',
      '@keyframes bgcSparkle{0%{opacity:0;transform:scale(.3) rotate(0)}28%{opacity:1;transform:scale(1.15) rotate(38deg)}60%{opacity:.6;transform:scale(.9) rotate(-16deg)}100%{opacity:0;transform:scale(.2) rotate(-54deg)}}',

      '.bgc-art{position:relative;display:flex;align-items:center;justify-content:center;min-height:170px;overflow:hidden;background:linear-gradient(180deg,#f8fafc,#eef2f7)}',
      '.bgc-art::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 -22px 26px -20px rgba(16,24,40,.28),inset 0 12px 20px -16px rgba(16,24,40,.14)}',
      '.bgc-art img{display:block;width:100%;max-height:45vh;object-fit:contain;animation:bgcBreathe 4.2s ease-in-out infinite}',
      '@keyframes bgcBreathe{0%,100%{transform:scale(1) rotate(-.5deg)}50%{transform:scale(1.04) rotate(.7deg)}}',
      '.bgc-artBadge{position:absolute;left:12px;bottom:12px;z-index:1;max-width:calc(100% - 24px);padding:4px 11px;border-radius:999px;background:rgba(30,64,175,.94);color:#fff;font-size:11px;font-weight:700;letter-spacing:.03em;box-shadow:0 3px 10px rgba(16,24,40,.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:bgcFadeUp .4s ease .18s both}',

      '.bgc-body{display:flex;flex-direction:column;gap:9px;padding:14px 16px 6px;min-width:0;overflow:auto;background:#fff;color:#101828}',
      '.bgc-titleRow{display:flex;align-items:center;gap:9px;min-width:0}',
      '.bgc-headline{margin:0;flex:1 1 auto;min-width:0;font-size:15.5px;font-weight:800;letter-spacing:.01em;color:#101828}',
      '.bgc-count{flex:0 0 auto;min-width:21px;height:21px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#eff4ff;color:#1d4ed8;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;border:1px solid rgba(37,99,235,.2)}',
      '.bgc-details{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;min-width:0}',
      '.bgc-detail{position:relative;display:flex;flex-direction:column;gap:3px;min-width:0;padding:8px 10px 8px 13px;border-radius:8px;background:#f8fafc;border-left:3px solid #3b82f6;animation:bgcDetailIn .38s cubic-bezier(.2,.9,.3,1) both}',
      '@keyframes bgcDetailIn{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}',
      '.bgc-detailLabel{min-width:0;font-size:11px;font-weight:600;letter-spacing:.01em;color:#667085;overflow-wrap:anywhere}',
      '.bgc-detailChange{display:flex;gap:6px;flex-wrap:wrap;align-items:baseline;min-width:0;font-size:12.5px;color:#101828;word-break:break-word}',
      '.bgc-from{min-width:0;color:#b42318;text-decoration:line-through;text-decoration-thickness:1px;opacity:.82;word-break:break-all;overflow-wrap:anywhere;flex:0 1 auto}',
      '.bgc-arrow{color:#98a2b3;font-weight:700;flex:0 0 auto;padding:0 1px}',
      '.bgc-to{min-width:0;color:#027a48;font-weight:650;word-break:break-all;overflow-wrap:anywhere;flex:0 1 auto}',
      '.bgc-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px 14px;background:#fff;color:inherit}',

      /* ---------------- dark ---------------- */

      ':is(html,body)[data-ds-dark-theme] .bgc-card{box-shadow:0 1px 2px rgba(0,0,0,.3)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-input{background:#1c1f25;border-color:#3a3f4a;color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-input:hover{border-color:#4a5060}',
      ':is(html,body)[data-ds-dark-theme] .bgc-input:focus{background:#1c1f25}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btn{background:#2a2f38;border-color:#3f4551;color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btn:hover:not(:disabled){background:#343a45;border-color:#525a68;color:#fff}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnPrimary{background:linear-gradient(180deg,#2f6fe4,#1d4ed8);border-color:transparent;color:#fff}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnPrimary:hover:not(:disabled){background:linear-gradient(180deg,#3b7ceb,#1e40af);color:#fff}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnDanger{border-color:rgba(248,113,113,.45);color:#fca5a5}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnDanger:hover:not(:disabled){background:rgba(248,113,113,.14);border-color:#f87171}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnGhost{color:#98a2b3}',
      ':is(html,body)[data-ds-dark-theme] .bgc-btnGhost:hover:not(:disabled){background:rgba(152,162,179,.14);color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-pillOk{color:#75e0a7;background:rgba(18,183,106,.14);border-color:rgba(18,183,106,.34)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-pillBad{color:#fec84b;background:rgba(247,144,9,.15);border-color:rgba(247,144,9,.34)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-switch input[type="checkbox"]{background-color:#4a5060}',
      ':is(html,body)[data-ds-dark-theme] .bgc-switch input[type="checkbox"]:hover{background-color:#596173}',
      ':is(html,body)[data-ds-dark-theme] .bgc-switch input[type="checkbox"]:checked{background-color:#2563eb}',
      ':is(html,body)[data-ds-dark-theme] .bgc-switch input[type="checkbox"]:checked:hover{background-color:#1d4ed8}',
      ':is(html,body)[data-ds-dark-theme] .bgc-seg{background:#1c1f25;border-color:#3a3f4a}',
      ':is(html,body)[data-ds-dark-theme] .bgc-segBtn{color:#98a2b3}',
      ':is(html,body)[data-ds-dark-theme] .bgc-segBtn:hover{background:rgba(152,162,179,.14);color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-segBtn[data-on="true"]{background:linear-gradient(180deg,#2f6fe4,#1d4ed8);color:#fff}',
      ':is(html,body)[data-ds-dark-theme] .bgc-pop{background:#16191f;color:#f2f4f7;border-color:#2b303a;box-shadow:0 32px 80px -12px rgba(0,0,0,.72),0 0 0 1px rgba(255,255,255,.05) inset,0 0 0 4px rgba(59,130,246,.2)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-art{background:linear-gradient(180deg,#12151a,#1b1f26)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-body{background:#16191f;color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-headline{color:#f2f4f7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-count{background:rgba(59,130,246,.17);color:#93c5fd;border-color:rgba(59,130,246,.32)}',
      ':is(html,body)[data-ds-dark-theme] .bgc-detail{background:#1c2027}',
      ':is(html,body)[data-ds-dark-theme] .bgc-detailLabel{color:#98a2b3}',
      ':is(html,body)[data-ds-dark-theme] .bgc-detailChange{color:#e4e7ec}',
      ':is(html,body)[data-ds-dark-theme] .bgc-arrow{color:#667085}',
      ':is(html,body)[data-ds-dark-theme] .bgc-from{color:#fda29b}',
      ':is(html,body)[data-ds-dark-theme] .bgc-to{color:#75e0a7}',
      ':is(html,body)[data-ds-dark-theme] .bgc-foot{background:#16191f}',

      /* ---------------- motion modes ---------------- */

      '.bgc-motion-off .bgc-shake,.bgc-motion-off .bgc-rays,.bgc-motion-off .bgc-headGlow,.bgc-motion-off .bgc-headTitle,.bgc-motion-off .bgc-sparkle,.bgc-motion-off .bgc-art img,.bgc-motion-off .bgc-detail,.bgc-motion-off .bgc-dot,.bgc-motion-off .bgc-kickerDot,.bgc-motion-off .bgc-card{animation:none !important}',
      '.bgc-motion-off .bgc-popIn{animation:bgcSoftIn .3s ease-out both}',
      '@keyframes bgcSoftIn{from{opacity:0;transform:scale(.975)}to{opacity:1;transform:none}}',
      '.bgc-motion-off .bgc-popOut{animation:bgcSoftOut .24s ease-in both !important}',
      '@keyframes bgcSoftOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(.98)}}',
      '.bgc-motion-off .bgc-flash{display:none}',
      '.bgc-motion-off .bgc-btnPrimary::after{display:none}',

      '@media (prefers-reduced-motion: reduce){',
      '  .bgc-motion-adaptive .bgc-shake,.bgc-motion-adaptive .bgc-rays,.bgc-motion-adaptive .bgc-headGlow,.bgc-motion-adaptive .bgc-headTitle,.bgc-motion-adaptive .bgc-sparkle,.bgc-motion-adaptive .bgc-art img,.bgc-motion-adaptive .bgc-detail,.bgc-motion-adaptive .bgc-dot,.bgc-motion-adaptive .bgc-kickerDot{animation:none !important}',
      '  .bgc-motion-adaptive .bgc-popIn{animation:bgcSoftIn .3s ease-out both}',
      '  .bgc-motion-adaptive .bgc-popOut{animation:bgcSoftOut .24s ease-in both !important}',
      '  .bgc-motion-adaptive .bgc-flash{display:none}',
      '}',
    ].join('')


    function readSeen() {
      try {
        return window.localStorage.getItem(SEEN_KEY)
      } catch {
        return null
      }
    }

    function writeSeen(id) {
      try {
        if (id === null) window.localStorage.removeItem(SEEN_KEY)
        else window.localStorage.setItem(SEEN_KEY, id)
      } catch {
        /* private mode */
      }
    }

    function getJson(query) {
      return fetch(API + '?' + query, { cache: 'no-store', credentials: 'same-origin' }).then(async (response) => {
        const body = await response.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }))
        if (!response.ok || body.ok === false) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
        return body
      })
    }

    function postJson(action, payload) {
      return fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ action: action }, payload || {})),
      }).then(async (response) => {
        const body = await response.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }))
        if (!response.ok || body.ok === false) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
        return body
      })
    }

    function formatNumber(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value)
      return n.toLocaleString('en-US')
    }

    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      const pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function makeTranslate(ctx) {
      const fallback = (key) => {
        const snapshot = typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null
        const id = snapshot && typeof snapshot.id === 'string' ? snapshot.id : ''
        const dict = id.toLowerCase().indexOf('zh') === 0 ? zh : en
        return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key)
      }
      try {
        const bound = ctx.locale.bind(NS)
        return (key, vars) => {
          const text = bound(key, vars)
          return text === key ? fallback(key) : text
        }
      } catch {
        return fallback
      }
    }

    function motionClass(mode) {
      if (mode === 'off') return 'bgc-motion-off'
      if (mode === 'full') return 'bgc-motion-full'
      return 'bgc-motion-adaptive'
    }

    /* ------------------------------------------------------------------ */
    /* Settings page                                                       */
    /* ------------------------------------------------------------------ */

    function statCard(key, value) {
      return h('div', { className: 'bgc-stat', key },
        h('span', { className: 'bgc-statKey' }, key),
        h('span', { className: 'bgc-statVal' }, value))
    }

    function SettingsPanel(props) {
      const t = props.t || props.tr

      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState('')
      const [keyDraft, setKeyDraft] = useState('')
      const [keyNote, setKeyNote] = useState(null)
      const [note, setNote] = useState(null)
      const [intervalDraft, setIntervalDraft] = useState('60')
      const [baseDraft, setBaseDraft] = useState('')
      const [watchDraft, setWatchDraft] = useState('')
      const [volumeDraft, setVolumeDraft] = useState(55)
      const [audioNote, setAudioNote] = useState(null)

      const applyState = useCallback((next) => {
        setState(next)
        if (!next) return
        const settings = next.settings || {}
        setIntervalDraft(String(settings.intervalMinutes))
        setBaseDraft(settings.apiBaseUrl || '')
        setWatchDraft((settings.watchModels || []).join(', '))
        setVolumeDraft(Math.round((Number(settings.volume) || 0) * 100))
      }, [])

      const refresh = useCallback(async () => {
        try {
          applyState(await getJson('action=state'))
          setError(null)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }, [applyState])

      useEffect(() => {
        void refresh()
      }, [refresh])

      const run = useCallback(async (label, operation) => {
        setBusy(label)
        setError(null)
        try {
          const result = await operation()
          if (result && result.state) applyState(result.state)
          else await refresh()
          return result
        } catch (e) {
          setError(String((e && e.message) || e))
          return null
        } finally {
          setBusy('')
        }
      }, [applyState, refresh])

      const saveSettings = useCallback(async (patch) => {
        const result = await run('settings', () => postJson('saveSettings', { settings: patch }))
        // `run` already applied the Host's fresh snapshot, which carries a
        // recomputed `cost` for the new interval. Merging the closure `state`
        // here used to put the stale cost back, so the figure never moved.
        if (result && result.state) return
        if (result && result.settings) applyState(Object.assign({}, state, { settings: result.settings }))
      }, [run, state, applyState])

      const saveKey = useCallback(() => run('key', async () => {
        if (keyDraft.trim() === '') throw new Error(t('key.empty'))
        await postJson('saveKey', { key: keyDraft })
        setKeyDraft('')
        setKeyNote(t('key.saved'))
        return getJson('action=state').then((body) => { applyState(body); return body })
      }), [run, keyDraft, t, applyState])

      const clearKey = useCallback(() => run('keyClear', async () => {
        await postJson('clearKey')
        setKeyNote(t('key.cleared'))
        return getJson('action=state').then((body) => { applyState(body); return body })
      }), [run, t, applyState])

      const probeNow = useCallback(() => run('probe', async () => {
        const result = await postJson('probeNow')
        if (result && result.event) {
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: result.event }))
          setNote(t('popup.title'))
        } else if (result && result.action === 'unchanged') {
          setNote(t('probe.unchanged'))
        } else if (result && result.action === 'baseline') {
          setNote(t('probe.baselineSet'))
        } else {
          setNote(null)
        }
        return result
      }), [run, t])

      const rebaseline = useCallback(() => run('rebaseline', async () => {
        const result = await postJson('rebaseline')
        setNote(t('probe.baselineSet'))
        return result
      }), [run, t])

      const preview = useCallback(async () => {
        try {
          const result = await postJson('demo')
          if (result && result.event) window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: result.event }))
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }, [])

      const testSound = useCallback(async () => {
        const current = (state && state.settings) || {}
        // Unlock inside the gesture, before any await.
        unlockAudio()
        const volume = current.sound === false ? 0 : (Number(current.volume) || 0.55)
        if (!(volume > 0)) {
          setAudioNote(t('look.muted'))
          return
        }
        // reason=null: a manual press always plays, however many times.
        const played = playCue('test', volume, null)
        setAudioNote(played ? null : t('look.audioFail'))
      }, [state, t])

      if (state === null) {
        return h('div', { className: 'bgc-root bgc-section' },
          h('p', { className: 'bgc-lead' }, error || '…'))
      }

      const settings = state.settings
      // While the interval field is being edited the saved cost is stale, so
      // project it locally. `perCycle` still comes from the Host (it knows how
      // many models are watched); only the day/month split is recomputed here.
      const draftInterval = Number(intervalDraft)
      const previewValid = Number.isFinite(draftInterval) && draftInterval >= 1
      const cost = state.cost === undefined || state.cost === null
        ? null
        : (previewValid && draftInterval !== state.cost.intervalMinutes
          ? (() => {
              const perDay = Math.round((state.cost.perCycle * 1440) / draftInterval)
              return Object.assign({}, state.cost, { perDay, perMonth: perDay * 30, intervalMinutes: draftInterval })
            })()
          : state.cost)
      const key = state.key || { configured: false, hint: null }
      const stats = state.stats || {}
      const motion = settings.motion || 'full'
      const soundOn = settings.sound !== false

      // One wording for every preset: minutes stay minutes and hours stay
      // hours, so nothing looks like a different kind of unit.
      const shortcuts = [1, 5, 60, 360, 1440].map((value) => h('button', {
        key: value,
        type: 'button',
        className: 'bgc-btn bgc-preset',
        onClick: () => {
          setIntervalDraft(String(value))
          void saveSettings({ intervalMinutes: value })
        },
      }, value >= 60
        ? t('common.hoursShort', { n: value / 60 })
        : t('common.minutesShort', { n: value })))

      const fingerprints = Object.entries(state.baselineFingerprints || {})
      const fingerprintRows = fingerprints.length === 0
        ? [h('p', { key: 'none', className: 'bgc-hint' }, t('status.none'))]
        : fingerprints.map((pair) => h('p', {
            key: pair[0],
            className: 'bgc-mono',
            style: { margin: '2px 0 0' },
          }, pair[0] + ' → ' + (pair[1] || '—')))

      const history = state.history || []
      const historyRows = history.length === 0
        ? h('p', { className: 'bgc-hint' }, t('history.empty'))
        : h('div', { className: 'bgc-history' }, history.slice(0, 12).map((item) => h('div', {
            key: item.id,
            className: 'bgc-historyItem',
          },
          h('div', { className: 'bgc-historyTop' },
            h('span', { className: 'bgc-historyHead' }, item.headline),
            h('span', { className: 'bgc-historyTime' }, formatTime(item.at))),
          h('div', { className: 'bgc-hint' },
            (item.details || []).map((detail) => detail.label).slice(0, 4).join(' · ')))))

      const keyCard = h('section', { className: 'bgc-card' },
        h('div', { className: 'bgc-cardHead' },
          h('h3', { className: 'bgc-cardTitle' }, t('key.title')),
          h('span', { className: 'bgc-pill ' + (key.configured ? 'bgc-pillOk' : 'bgc-pillBad') },
            h('i', { className: 'bgc-dot' }),
            key.configured ? t('key.configured') + (key.hint ? ' · ' + key.hint : '') : t('key.missing'))),
        h('div', { className: 'bgc-row' },
          h('input', {
            className: 'bgc-input bgc-inputWide',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: t('key.placeholder'),
            value: keyDraft,
            onChange: (event) => {
              setKeyDraft(event.target.value)
              setKeyNote(null)
            },
          }),
          h('button', {
            type: 'button',
            className: 'bgc-btn bgc-btnPrimary',
            disabled: busy === 'key' || keyDraft.trim() === '',
            onClick: () => void saveKey(),
          }, busy === 'key' ? '…' : t('key.save')),
          h('button', {
            type: 'button',
            className: 'bgc-btn bgc-btnDanger',
            disabled: busy === 'keyClear' || !key.configured,
            onClick: () => void clearKey(),
          }, t('key.clear'))),
        h('p', { className: 'bgc-hint' }, keyNote || t('key.hint')))

      const probeCard = h('section', { className: 'bgc-card' },
        h('div', { className: 'bgc-cardHead' },
          h('h3', { className: 'bgc-cardTitle' }, t('probe.title')),
          h('label', { className: 'bgc-switch' },
            h('input', {
              type: 'checkbox',
              checked: settings.autoDetect !== false,
              onChange: (event) => {
                const checked = event.target.checked
                applyState(Object.assign({}, state, { settings: Object.assign({}, settings, { autoDetect: checked }) }))
                void saveSettings({ autoDetect: checked })
              },
            }),
            h('span', null, t('probe.auto')))),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('probe.interval')),
          h('input', {
            className: 'bgc-input bgc-inputNarrow',
            type: 'number',
            min: 1,
            max: 10080,
            value: intervalDraft,
            onChange: (event) => setIntervalDraft(event.target.value),
            onBlur: () => {
              const parsed = Number(intervalDraft)
              const next = Number.isFinite(parsed) ? Math.min(10080, Math.max(1, Math.round(parsed))) : settings.intervalMinutes
              setIntervalDraft(String(next))
              if (next !== settings.intervalMinutes) void saveSettings({ intervalMinutes: next })
            },
          }),
          h('span', { className: 'bgc-hint' }, t('probe.minutes')),
          // Its own row: the presets used to wrap under the input when the
          // label + field came close to the card width.
          h('div', { className: 'bgc-presets' },
            h('span', { className: 'bgc-presetsLabel' }, t('probe.presets')),
            shortcuts)),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('probe.baseUrl')),
          h('input', {
            className: 'bgc-input bgc-inputWide',
            type: 'text',
            spellCheck: false,
            value: baseDraft,
            onChange: (event) => setBaseDraft(event.target.value),
            onBlur: () => {
              if (baseDraft.trim() !== '' && baseDraft !== settings.apiBaseUrl) void saveSettings({ apiBaseUrl: baseDraft.trim() })
            },
          })),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('probe.watch')),
          h('input', {
            className: 'bgc-input bgc-inputWide',
            type: 'text',
            spellCheck: false,
            placeholder: (state.baselineModels || []).join(', '),
            value: watchDraft,
            onChange: (event) => setWatchDraft(event.target.value),
            onBlur: () => {
              const list = watchDraft.split(',').map((item) => item.trim()).filter((item) => item !== '')
              if (JSON.stringify(list) !== JSON.stringify(settings.watchModels)) void saveSettings({ watchModels: list })
            },
          })),
        h('p', { className: 'bgc-hint' }, t('probe.watchHint')),
        h('p', { className: 'bgc-hint', style: { color: 'var(--dsw-alias-label-primary)' } },
          cost === null ? '…' : t('probe.cost', {
            perCycle: formatNumber(cost.perCycle),
            models: cost.models,
            perDay: formatNumber(cost.perDay),
            perMonth: formatNumber(cost.perMonth),
          })),
        h('p', { className: 'bgc-hint' }, t('probe.costNote')),
        h('div', { className: 'bgc-row' },
          h('button', {
            type: 'button',
            className: 'bgc-btn bgc-btnPrimary',
            disabled: busy !== '' || state.running,
            onClick: () => void probeNow(),
          }, busy === 'probe' || state.running ? t('probe.probing') : t('probe.now')),
          h('button', {
            type: 'button',
            className: 'bgc-btn',
            disabled: busy !== '' || state.running || !key.configured,
            onClick: () => void rebaseline(),
          }, busy === 'rebaseline' ? '…' : t('probe.rebaseline')),
          h('button', {
            type: 'button',
            className: 'bgc-btn',
            onClick: () => void preview(),
          }, h('span', { className: 'bgc-btnIcon' }, '✨'), t('probe.demo')),
          note ? h('span', { className: 'bgc-hint' }, note) : null),
        h('p', { className: 'bgc-hint' }, t('probe.demoHint')))

      const motionButtons = [['adaptive', t('look.motionAdaptive')], ['full', t('look.motionFull')], ['off', t('look.motionOff')]]
        .map((pair) => h('button', {
          key: pair[0],
          type: 'button',
          className: 'bgc-segBtn',
          'data-on': String(motion === pair[0]),
          'aria-pressed': motion === pair[0],
          onClick: () => void saveSettings({ motion: pair[0] }),
        }, pair[1]))

      const lookCard = h('section', { className: 'bgc-card' },
        h('h3', { className: 'bgc-cardTitle' }, t('look.title')),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('look.motion')),
          h('div', { className: 'bgc-seg' }, motionButtons)),
        h('p', { className: 'bgc-hint' }, t('look.motionHint')),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('look.sound')),
          h('label', { className: 'bgc-switch' },
            h('input', {
              type: 'checkbox',
              checked: soundOn,
              onChange: (event) => {
                const checked = event.target.checked
                applyState(Object.assign({}, state, { settings: Object.assign({}, settings, { sound: checked }) }))
                void saveSettings({ sound: checked })
              },
            }),
            h('span', null, soundOn ? t('popup.soundOn') : t('popup.soundOff'))),
          h('button', {
            type: 'button',
            className: 'bgc-btn bgc-btnGhost',
            onClick: () => void testSound(),
          }, h('span', { className: 'bgc-btnIcon' }, '🔊'), t('look.test'))),
        h('div', { className: 'bgc-row' },
          h('span', { className: 'bgc-rowLabel' }, t('look.volume')),
          h('input', {
            className: 'bgc-range',
            type: 'range',
            min: 0,
            max: 100,
            step: 5,
            value: volumeDraft,
            onChange: (event) => setVolumeDraft(Number(event.target.value)),
            onPointerUp: () => void saveSettings({ volume: volumeDraft / 100 }),
            onKeyUp: () => void saveSettings({ volume: volumeDraft / 100 }),
          }),
          h('span', { className: 'bgc-hint' }, String(volumeDraft) + '%')),
        h('p', { className: 'bgc-hint' }, audioNote || t('look.hint')))

      const statusCard = h('section', { className: 'bgc-card' },
        h('h3', { className: 'bgc-cardTitle' }, t('status.title')),
        h('div', { className: 'bgc-status' },
          statCard(t('status.baseline'), formatTime(state.baselineAt)),
          statCard(t('status.checks'), String(stats.checks || 0)),
          statCard(t('status.changes'), String(stats.changes || 0)),
          statCard(t('status.lastCheck'), formatTime(stats.lastCheckAt)),
          statCard(t('status.lastError'), stats.lastError || '—')),
        h('div', null,
          h('p', { className: 'bgc-hint' }, t('status.models')),
          h('p', { className: 'bgc-mono', style: { margin: '2px 0 0' } },
            (state.baselineModels || []).join(' · ') || t('status.none'))),
        h('div', null,
          h('p', { className: 'bgc-hint' }, t('status.fingerprints')),
          fingerprintRows))

      const historyCard = h('section', { className: 'bgc-card' },
        h('h3', { className: 'bgc-cardTitle' }, t('history.title')),
        historyRows)

      return h('div', { className: 'bgc-root bgc-section ' + motionClass(motion) },
        h('p', { className: 'bgc-lead' }, t('section.desc')),
        error ? h('p', { className: 'bgc-hint', style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)' } }, error) : null,
        keyCard,
        probeCard,
        lookCard,
        statusCard,
        historyCard,
        state.stateFile ? h('p', { className: 'bgc-hint bgc-mono' }, t('status.file') + '：' + state.stateFile) : null)
    }

    /* ------------------------------------------------------------------ */
    /* The popup                                                           */
    /* ------------------------------------------------------------------ */

    function Popup(props) {
      const t = props.t
      const event = props.event
      const settings = props.settings || {}
      const motion = settings.motion || 'full'
      const soundOn = settings.sound !== false
      const volume = Number(settings.volume) || 0.55

      const [expanded, setExpanded] = useState(false)
      const [leaving, setLeaving] = useState(false)
      const [muted, setMuted] = useState(!soundOn)
      const finished = useRef(false)
      const eventId = event ? event.id : null

      const finish = useCallback(() => {
        if (finished.current) return
        finished.current = true
        if (typeof props.onDone === 'function') props.onDone()
      }, [props.onDone])

      // The entrance effect must depend on the event alone. Settings live in a
      // ref so a volume change or a re-render cannot replay the blast; the
      // dedupe window in playCue is the second line of defence.
      const settingsRef = useRef(settings)
      settingsRef.current = settings

      useEffect(() => {
        // Hooks run before the `if (!event) return null` guard below, so an
        // idle popup reaches this effect too. Without this check the empty
        // state fired a blast on every mount — which is what "the sound never
        // stops" sounded like.
        if (eventId === null || eventId === undefined) return undefined
        setExpanded(false)
        setLeaving(false)
        setMuted(settingsRef.current.sound === false)
        finished.current = false
        // The blast is the popup arriving: one shot, per event.
        if (settingsRef.current.sound !== false) {
          playCue('blast', Number(settingsRef.current.volume) || 0.55, 'popup:' + eventId)
        }
        const timer = window.setTimeout(() => setLeaving(true), AUTO_CLOSE_MS)
        return () => window.clearTimeout(timer)
      }, [eventId])

      // The exit animation normally calls `finish`; without one (reduced motion,
      // or a browser that skips it) this timer is the guarantee the card leaves
      // the queue. `finish` is intentionally not a dependency: with an inline
      // `onDone` from the parent it changes identity on every render, which
      // restarted this effect and re-fired the exit sound in a loop.
      const finishRef = useRef(finish)
      finishRef.current = finish

      useEffect(() => {
        if (!leaving) return undefined
        const timer = window.setTimeout(() => finishRef.current(), 900)
        return () => window.clearTimeout(timer)
      }, [leaving])

      useEffect(() => {
        const onKey = (keyEvent) => {
          if (keyEvent.key === 'Escape') setLeaving(true)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      if (!event) return null

      const details = Array.isArray(event.details) ? event.details : []
      const visible = expanded ? details : details.slice(0, COLLAPSED_ROWS)
      const memeUrl = API + '?action=meme&id=' + encodeURIComponent(event.meme || '1.jpg') + '&v=' + encodeURIComponent(event.id || '')

      const sparklePositions = [[8, '✦', 0], [27, '✧', 0.7], [48, '★', 1.4], [69, '✦', 0.4], [86, '✧', 1.9]]

      const toggleSound = () => {
        const next = !muted
        setMuted(next)
        if (next) stopSound()
        else playCue('tick', Number(settings.volume) || 0.55, 'unmute')
      }

      // The backdrop stays click-through on purpose: `shell.overlay` is
      // documented as a layer the app underneath keeps working behind, so the
      // card is the only part that takes pointer events.
      return h('div', {
        className: 'bgc-overlay ' + motionClass(motion),
        role: 'dialog',
        'aria-label': t('popup.title'),
      },
        h('div', { className: 'bgc-shake' },
          h('div', {
            className: 'bgc-pop ' + (leaving ? 'bgc-popOut' : 'bgc-popIn'),
            onClick: (clickEvent) => clickEvent.stopPropagation(),
            onAnimationEnd: (animationEvent) => {
              // Child animations bubble here; only the card's own exit counts.
              if (leaving && animationEvent.target === animationEvent.currentTarget) finish()
            },
          },
            h('div', { className: 'bgc-head' },
              h('div', { className: 'bgc-rays', 'aria-hidden': 'true' }),
              h('div', { className: 'bgc-headGlow', 'aria-hidden': 'true' }),
              h('div', { className: 'bgc-headText' },
                h('span', { className: 'bgc-kicker' },
                  h('span', { className: 'bgc-kickerDot' }),
                  t('popup.kicker')),
                h('span', { className: 'bgc-headTitle' }, t('popup.title')),
                h('span', { className: 'bgc-headSub' }, formatTime(event.at))),
              h('div', { className: 'bgc-sparkles', 'aria-hidden': 'true' },
                sparklePositions.map((item, index) => h('span', {
                  key: index,
                  className: 'bgc-sparkle',
                  style: { left: item[0] + '%', top: (12 + (index * 17) % 58) + '%', animationDelay: item[2] + 's' },
                }, item[1])))),

            h('div', { className: 'bgc-art' },
              h('img', { src: memeUrl, alt: event.headline || t('popup.title'), draggable: false }),
              h('span', { className: 'bgc-artBadge' }, event.headline || '')),

            h('div', { className: 'bgc-body' },
              h('div', { className: 'bgc-titleRow' },
                h('p', { className: 'bgc-headline' }, event.headline || t('popup.subtitle')),
                // Only when something is actually hidden: while every row is
                // visible the tally repeats what the list already shows.
                details.length > COLLAPSED_ROWS
                  ? h('span', {
                      className: 'bgc-count',
                      title: t('popup.countHint', { n: details.length }),
                    }, t('popup.count', { n: details.length }))
                  : null),
              h('ul', { className: 'bgc-details' },
                visible.map((detail, index) => h('li', {
                  key: index,
                  className: 'bgc-detail',
                  style: { animationDelay: (0.07 * index) + 's' },
                },
                h('span', { className: 'bgc-detailLabel' }, detail.label),
                h('span', { className: 'bgc-detailChange' },
                  h('span', { className: 'bgc-from' }, String(detail.from == null ? '—' : detail.from)),
                  h('span', { className: 'bgc-arrow' }, '→'),
                  h('span', { className: 'bgc-to' }, String(detail.to == null ? '—' : detail.to))))))),

            h('div', { className: 'bgc-foot' },
              h('div', { className: 'bgc-row', style: { gap: 4 } },
                details.length > COLLAPSED_ROWS
                  ? h('button', {
                      type: 'button',
                      className: 'bgc-btn bgc-btnGhost',
                      onClick: () => setExpanded((value) => !value),
                    }, expanded ? t('popup.less') : t('popup.more'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'bgc-btn bgc-btnGhost',
                  'aria-pressed': muted,
                  title: muted ? t('popup.soundOff') : t('popup.soundOn'),
                  onClick: toggleSound,
                }, muted ? '🔇' : '🔊')),
              h('button', {
                type: 'button',
                className: 'bgc-btn bgc-btnPrimary',
                onClick: () => setLeaving(true),
              }, t('popup.close'))))),
        h('div', { className: 'bgc-flash', 'aria-hidden': 'true' }))
    }

    function Overlay(props) {
      const t = props.t
      const [queue, setQueue] = useState([])
      const [settings, setSettings] = useState({ motion: 'full', sound: true, volume: 0.55 })
      const seenRef = useRef(readSeen())

      useEffect(() => {
        let cancelled = false

        const push = (event) => {
          if (!event || !event.id) return
          if (seenRef.current === event.id) return
          // `since` is a cursor into the Host's history. A preview id is not in
          // that history, so storing it would leave every later poll asking
          // about an entry the server never had. Queue it, forget it.
          if (event.demo !== true) {
            seenRef.current = event.id
            writeSeen(event.id)
          }
          setQueue((current) => (current.some((item) => item.id === event.id) ? current : current.concat([event])))
        }

        const poll = async (first) => {
          try {
            const body = await getJson('action=poll&since=' + encodeURIComponent(seenRef.current || ''))
            if (cancelled) return
            if (body.settings) setSettings(body.settings)
            const event = body.latest
            if (!event || !event.id || event.id === seenRef.current) return
            // A page left in a drawer overnight should not greet the user with
            // three stale jokes.
            const age = Date.now() - new Date(event.at).getTime()
            if (Number.isFinite(age) && age > 24 * 3600 * 1000) {
              seenRef.current = event.id
              writeSeen(event.id)
              return
            }
            // "Preview once" arrives through the local event, not the poll.
            push(event)
            if (first) setSettings(body.settings || settings)
          } catch {
            /* host not reachable yet */
          }
        }

        const onLocal = (event) => push(event.detail)
        window.addEventListener(EVENT_NAME, onLocal)
        void poll(true)
        const timer = window.setInterval(() => void poll(false), POLL_MS)
        return () => {
          cancelled = true
          window.clearInterval(timer)
          window.removeEventListener(EVENT_NAME, onLocal)
        }
      }, [])

      const current = queue.length > 0 ? queue[0] : null

      // A stable identity: an inline arrow here is a new function on every
      // render, and any child effect depending on it would restart forever.
      const dismiss = useCallback(() => {
        stopSound()
        setQueue((list) => list.slice(1))
      }, [])

      return h(Popup, {
        key: current ? current.id : 'idle',
        event: current,
        settings: settings,
        t: t,
        onDone: dismiss,
      })
    }

    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale']

    /**
     * The two surfaces mount in different slots at different times (the popup
     * only exists after a change is detected), so a `<style>` element rendered
     * by either component would leave the other unstyled. A skin theme makes
     * that visible immediately: the settings page's controls fall back to the
     * theme's bare `button` rule, whose background and label are the same
     * colour. One stylesheet, installed by the plugin itself, removes the
     * ordering problem entirely.
     */
    function installStyles() {
      if (typeof document === 'undefined') return
      const existing = document.querySelector('style[data-plugin="dsh-big-coming"]')
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS
      } else {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', 'dsh-big-coming')
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }

    function apply(ctx) {
      const tr = makeTranslate(ctx)

      ctx.effect(() => {
        installStyles()
        return () => {
          const tag = typeof document === 'undefined' ? null : document.querySelector('style[data-plugin="dsh-big-coming"]')
          if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag)
        }
      }, 'dsh-big-coming: styles')

      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'dsh-big-coming: dictionaries')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'big-coming',
        order: 55,
        locale: NS,
        label: () => tr('nav.label'),
      }, (props) => h(SettingsPanel, Object.assign({ tr: tr }, props, { t: props.t || tr }))))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'big-coming-popup',
        order: 60,
        locale: NS,
      }, (props) => h(Overlay, Object.assign({}, props, { t: props.t || tr }))))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
