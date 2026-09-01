/**
 * Turnstile 站点密钥（sitekey）。这是**公开值**，本来就要嵌进 HTML 给浏览器看，
 * 进仓库没有问题。真正的密钥（secret）在 Pages 的环境变量 TURNSTILE_SECRET 里，
 * 只有服务端函数读得到，绝不进代码。
 *
 * 换 widget 时改这一处；对应的域名白名单在 Cloudflare 后台
 * （当前允许 geshuo.pages.dev / localhost / 127.0.0.1，本地 dev 也能过）。
 */
export const TURNSTILE_SITEKEY = '0x4AAAAAAEkFYLEbUCZgV7GF';
