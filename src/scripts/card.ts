/**
 * 把一拍存成一张竖图。
 *
 * 为什么是「一拍」而不是「一场戏」：**没有人会转发一场戏。** 人转发的是
 * 一句好笑的话。站上原先没有任何一句话有自己的分享物——没有卡片、没有能
 * 截图就发的东西，所以它自己走不出去。
 *
 * 画在 canvas 上而不是截屏，是因为竖图的版式和网页的横排版式不是一回事：
 * 手机上转发要的是一屏能看完、字大、有落款。
 */

const W = 1080;
const PAD = 84;

interface Col {
  name: string;
  level: string;
  said: string;
  color: string;
  human: boolean;
}

/** 中文没有词边界，按字宽逐字断行就行 */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > max && line) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

function read(root: ParentNode): { title: string; crumb: string; cols: Col[] } {
  const cols = Array.from(root.querySelectorAll<HTMLElement>('.col')).map((el) => ({
    name: el.querySelector('.nm')?.textContent?.trim() ?? '',
    level: el.querySelector('.lv2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    said: el.querySelector('.said')?.textContent?.trim() ?? '',
    color: getComputedStyle(el).getPropertyValue('--c').trim() || '#333',
    human: el.classList.contains('real'),
  })).filter((c) => c.said);
  return {
    title: root.querySelector('h1')?.textContent?.trim() ?? '各说各话',
    crumb: root.querySelector('.situation')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    cols,
  };
}

export function initCard(root: ParentNode): void {
  const btn = root.querySelector<HTMLButtonElement>('#save-card');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const { title, crumb, cols } = read(root);
    if (cols.length === 0) return;

    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = '画着…';
    try {
      // 字体没就位就画，会画成一堆方块或退回系统字，整张图报废
      await (document.fonts?.ready ?? Promise.resolve());

      // 先量一遍高度再定画布尺寸——竖图不该有一大片空白落款区。
      // 上一版按估算给了个 max(1080, …) 的下限，结果短卡片底下空出一大块。
      const probe = document.createElement('canvas').getContext('2d')!;
      const inner = W - PAD * 2;

      // 标题**折行，不截断**。上一版 slice(0,14) 把「…怎么说的」截成「…怎么说」，
      // 意思都变了——截断标题是最不该省的地方。
      probe.font = '700 60px "Noto Serif SC", serif';
      const titleLines = wrap(probe, title, inner);
      probe.font = '600 46px "Noto Serif SC", serif';
      const wrapped = cols.map((c) => wrap(probe, c.said, inner));

      const HEAD = 40 + 40 + titleLines.length * 74 + 54;
      const BLOCK_GAP = 34;
      const bodyH = wrapped.reduce((h, ls) => h + 44 + ls.length * 62 + BLOCK_GAP, 0) - BLOCK_GAP;
      const FOOT = 132;
      const H = Math.round(PAD + HEAD + bodyH + FOOT);

      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d')!;

      ctx.fillStyle = '#EFEDE6';
      ctx.fillRect(0, 0, W, H);

      let y = PAD + 40;
      ctx.fillStyle = '#9C948A';
      ctx.font = '400 26px "Noto Sans SC", sans-serif';
      ctx.fillText(crumb, PAD, y);

      y += 40;
      ctx.fillStyle = '#1A1714';
      ctx.font = '700 60px "Noto Serif SC", serif';
      for (const ln of titleLines) {
        y += 74;
        ctx.fillText(ln, PAD, y);
      }

      y += 54;
      for (let i = 0; i < cols.length; i += 1) {
        const c = cols[i];
        // 色条＋地名：颜色就是地理，和网页上同一套
        ctx.fillStyle = c.color;
        ctx.fillRect(PAD, y - 4, c.human ? 8 : 4, 30);
        ctx.font = `${c.human ? 700 : 400} 27px "Noto Sans SC", sans-serif`;
        ctx.fillText(`${c.name}　${c.level}`, PAD + 24, y + 20);
        y += 44;

        ctx.fillStyle = c.human ? '#1A1714' : '#5C554B';
        ctx.font = '600 46px "Noto Serif SC", serif';
        for (const ln of wrapped[i]) {
          ctx.fillText(ln, PAD, y + 46);
          y += 62;
        }
        if (i < cols.length - 1) y += BLOCK_GAP;
      }

      ctx.strokeStyle = '#DCD7CB';
      ctx.beginPath();
      ctx.moveTo(PAD, H - 108);
      ctx.lineTo(W - PAD, H - 108);
      ctx.stroke();
      ctx.fillStyle = '#1A1714';
      ctx.font = '700 30px "Noto Serif SC", serif';
      ctx.fillText('各说各话', PAD, H - 60);
      ctx.fillStyle = '#9C948A';
      ctx.font = '400 25px "Noto Sans SC", sans-serif';
      ctx.fillText('geshuo.pages.dev　·　你们那儿怎么说？', PAD + 150, H - 60);

      const url = cv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `各说各话-${title.slice(0, 10)}.png`;
      a.click();
      btn.textContent = '存好了';
    } catch {
      btn.textContent = '画不出来，直接截图吧';
    } finally {
      window.setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 2400);
    }
  });
}
