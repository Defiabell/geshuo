/**
 * Turnstile 令牌供给。
 *
 * 三件事让它比"页面上摆个组件"复杂一点：
 *
 * 1. **令牌是一次性的**。录音页可以连传五拍，用同一个令牌第二次就会被服务端
 *    判为已使用。所以每消费一个就立刻 reset()，让下一个在后台先准备好。
 * 2. **令牌可能还没到**。脚本是异步加载的，人可能录完就点上传。getToken()
 *    因此返回 Promise，等到了再走。
 * 3. **脚本可能压根加载不出来**（网络问题、拦截插件）。这时要**明确失败**并
 *    说人话，而不是让上传按钮转圈转到天荒地老——上传注定会被服务端拒掉。
 */

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// 6 秒。等不到就走小额度那条路，让人干等 15 秒毫无意义
const READY_TIMEOUT_MS = 6000;

interface TurnstileApi {
  render(el: string | HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
let widgetId: string | undefined;
let current: string | null = null;
let waiters: Array<(t: string) => void> = [];
/** 最近一次 turnstile 报的错误码，超时时一并说给用户听 */
let lastError: string | null = null;

/**
 * 判断 API 是否真的就位。**不能只看 window.turnstile 是不是真值**：
 * HTML 的具名访问会把任何带 id 的元素挂到 window 上，页面里只要有一个
 * `<div id="turnstile">`，window.turnstile 就是那个 div——真值，于是脚本
 * 永远不会被加载，render 又不存在，最后静默失败。这个坑踩过一次。
 */
function apiOf(w: Window): TurnstileApi | null {
  const t = (w as { turnstile?: unknown }).turnstile;
  return t && typeof (t as TurnstileApi).render === 'function' ? (t as TurnstileApi) : null;
}

function loadScript(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const ready = apiOf(window);
    if (ready) { resolve(ready); return; }
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => {
      const api = apiOf(window);
      if (api) resolve(api);
      else reject(new Error('turnstile 脚本加载了但没挂上 API'));
    });
    s.addEventListener('error', () => reject(new Error('turnstile 脚本加载失败')));
    document.head.append(s);
  });
  return scriptPromise;
}

function handOut(token: string, api: TurnstileApi) {
  const w = waiters.shift();
  if (w) {
    w(token);
    // 交出去就作废，立刻要下一个——不 reset 的话第二次上传必然被判"令牌已用过"
    api.reset(widgetId);
  } else {
    current = token;
  }
}

/** 初始化：把不可见的验证组件挂到页面上。多次调用只会渲染一次 */
export async function initTurnstile(host: HTMLElement, sitekey: string): Promise<void> {
  const api = await loadScript();
  if (widgetId !== undefined) return;
  widgetId = api.render(host, {
    sitekey,
    // 不传 size：默认值最稳。之前传了 'flexible'，而排查时无法排除它是不是
    // 让组件静默不出 iframe 的原因——参数越少，出问题时能怀疑的东西越少。
    callback: (t: string) => handOut(t, api),
    // 空的 error-callback 等于把唯一的诊断信息扔掉。Turnstile 的错误码是
    // 有意义的（域名不在白名单、sitekey 不对等等），必须留痕。
    'error-callback': (code?: string) => {
      lastError = code ?? 'unknown';
      console.warn('[geshuo] turnstile error-callback:', code);
    },
    'expired-callback': () => { current = null; api.reset(widgetId); },
  });
}

/**
 * 取一个可用令牌。取到的令牌算被消费掉，下一个会在后台重新生成。
 * 拿不到时抛错，调用方据此提示"人机验证没过"，不要静默上传一个必被拒的请求。
 */
export function getToken(): Promise<string> {
  if (current) {
    const t = current;
    current = null;
    void loadScript().then((api) => api.reset(widgetId));
    return Promise.resolve(t);
  }
  return new Promise<string>((resolve, reject) => {
    waiters.push(resolve);
    setTimeout(() => {
      const i = waiters.indexOf(resolve);
      if (i >= 0) {
        waiters.splice(i, 1);
        reject(new Error(
          lastError
            ? `人机验证没通过（${lastError}）——刷新页面再试一次`
            : '人机验证没能加载出来——刷新页面，或检查是不是被拦截插件挡了',
        ));
      }
    }, READY_TIMEOUT_MS);
  });
}
