/** 《中国语言地图集》五层分区：大区—区—片—小片—点 */
export type DialectLevel = 'supergroup' | 'group' | 'cluster' | 'subcluster' | 'point';

export interface Dialect {
  id: string;
  name: string;
  level: DialectLevel;
  parentId: string | null;
  lng?: number;
  lat?: number;
  description?: string;
  /**
   * 有值＝**禁止任何 AI 生成挂到这个节点上**，值就是禁止的理由（会显示在页面上）。
   *
   * 这条取代了原先「AI 只到区级」的说法，因为那句话是错的。真正的分界不是层级，
   * 是**有没有事实标准形式**：粤语有正字有词典有字幕，东北话有影视标准腔，成渝片
   * 窄且一致——模型见过它们。冀鲁官话三样都没有，它是一个分类，不是任何人说的一
   * 种话，模型只能把济南的、胶东的、天津的碎片拼一起，拼出一个哪儿都不是的东西。
   * 2026-09-05 由武城母语者确认「几乎都不对」，33 条台词、28 个 mp3 因此下线。
   *
   * 所以规则是：**AI 只能做有标准形式的方言，其余那一格必须是空的。**
   * 空格不是缺失，是召唤——它明说「这里只能等本地人」。
   */
  noAiReason?: string;
}

/**
 * 一个县级行政区划。这是**真人贡献的主键**。
 *
 * 为什么不用方言区当主键：行政区划是确定的，方言分区是有争议的。这份仓库里
 * 武城的 `dialects.yaml` 条目写着「片级归属待考」——那不是谦虚，是真不知道。
 * 而且人知道自己是武城人，不知道自己是「冀鲁官话区」的人；让贡献者先选方言区
 * 等于在贡献之前先考他一道题。
 *
 * 方言归属退成 `dialectId` 这个可选注释：谁知道谁标，不标也能存在。它只用来
 * 做聚合展示，不参与身份。
 *
 * **点由贡献者创造，不预先枚举。** 语保预先定死了 1712 个调查点，我们不抄——
 * 枚举等于一上来就制造两千多个空页面，看着像烂尾工程。这里只登记真的有人
 * 贡献过的地方，地图上每多一个人就多亮一个点。空白因此是「还没人来」，
 * 不是「缺失」。
 */
export interface Place {
  /** GB/T 2260 六位行政区划代码，比如武城县 371428 */
  code: string;
  /** 县级名称，比如「武城县」 */
  name: string;
  province: string;
  city: string;
  lng: number;
  lat: number;
  /** 可选：这个地方属于哪个方言节点。只用于聚合展示，不是身份 */
  dialectId?: string;
}

/** 空拍的保留角色名：这一拍没人说话，不合成音频 */
export const NO_SPEAKER = 'none';

/**
 * 声色档位。TTS 音色按「方言 × 声色」两个维度查表（scripts/gen/src/tts.ts
 * 的 VOICES），而不是一个方言一个音色——一场家庭戏里妈妈和孩子必须是两种
 * 声色，全用同一个音色等于两个人共用一副嗓子，戏就散了。
 *
 * 档位是「场景描述角色」和「方言提供音色」之间的中间层：场景只说这个角色
 * 是什么声色（成年女性/成年男性…），各方言各自去找自己有的、能对上这个档位
 * 的真实方言音色。这样加新场景不用碰 TTS 代码，加新方言不用碰场景数据。
 */
export const VOICE_PROFILES = ['adult_female', 'adult_male', 'young_female', 'young_male'] as const;
export type VoiceProfile = (typeof VOICE_PROFILES)[number];

/**
 * 场景里的一个角色。角色是**场景自己声明的**，不是写死在代码里的枚举——
 * 「妈妈/孩子」只属于「深夜回家」，换成「菜市场砍价」就该是「摊主/顾客」。
 * 早先把 mom/kid 写死在 SPEAKER_ROLES 里，直接导致加第二个场景要改代码。
 */
export interface SceneRole {
  /** 页面上显示的称呼，比如「妈妈」 */
  name: string;
  /** 这个角色用哪一档声色 */
  voice: VoiceProfile;
  /** TTS 情绪指令，比如「用非常生气、音量大、语速快的口气说」；留空表示不加情绪 */
  mood?: string;
}

/**
 * 谁在说话：取值必须是所属场景 `roles` 里声明过的键，或保留值 'none'（空拍）。
 * 这是运行时约束，由 validateContent() 在构建期强制——TS 这里只能是 string，
 * 因为合法集合随场景而变，编译期不可知。
 */
export type SpeakerRole = string;

export interface Beat {
  id: string;
  order: number;
  intent: string;
  /** 谁在说话，必须是本场景 roles 的键或 'none' */
  speakerRole: SpeakerRole;
}

export interface Scene {
  id: string;
  title: string;
  situation: string;
  /**
   * 「一句话挑战」标记，值是这一期的日期（YYYY-MM-DD）。
   *
   * 一句话挑战本质上就是「只有一拍的场景」——所以不另起一套数据结构，
   * 复用场景的全部机制（校验、TTS 生成、横向对比、录音投稿）。有这个字段
   * 的场景恰好只能有一个说话拍，validateContent() 会强制。
   *
   * 存在的理由是投稿门槛：六拍要录五条，一句话只要录一条十五秒。深度内容
   * 靠戏，入口靠一句话。
   */
  weekly?: string;
  /** 本场景的角色表，键就是 beats 里 speakerRole 的合法取值 */
  roles: Record<string, SceneRole>;
  beats: Beat[];
}

/**
 * 三档可信度：unverified（AI 生成、未经母语者校对）/ native_verified
 * （AI 生成、已经母语者校对）/ human_recorded（真人录音）。这三档必须在
 * 页面上视觉可辨，不许塌成两档——见 src/lib/verification.ts。
 */
export const VERIFICATIONS = ['unverified', 'native_verified', 'human_recorded'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const TAKE_SOURCES = ['tts', 'human'] as const;
export type TakeSource = (typeof TAKE_SOURCES)[number];

/**
 * 文字跟录音的对应程度。这是**独立于可信度三档的另一根轴**：
 * verification 说的是「这段音靠不靠谱」，transcript 说的是「这些字是不是他
 * 逐字说的」。
 *
 * 为什么需要它：很多方言词没有定字（「多咱」「磕碜」算运气好的，更多只能拿
 * 同音字凑，或者压根写不出来）。逼投稿人逐字转写等于把门槛抬回没人进得来。
 * 语保工程、乡音苑同样是「音为主、字为辅」。
 *
 * 但读的人有权知道自己在读什么——所以不是放宽标准，是**把标准说出来**：
 * - `verbatim`：逐字转写，字就是他说的
 * - `approximate`：大意相符，用字不一定准
 *
 * 缺省不填时按 verbatim 处理（AI 演绎的字和音本来就是同一份文本生成的）。
 */
export const TRANSCRIPTS = ['verbatim', 'approximate'] as const;
export type Transcript = (typeof TRANSCRIPTS)[number];

export interface TakeLine {
  beatId: string;
  textDialect: string;
  textMandarin: string;
  note?: string;
  /** public/ 下的音频路径；未生成时为空 */
  audio?: string;
  /**
   * 音频时长（毫秒），由 ffprobe 在生成时量出来写回。
   *
   * 存在的理由：连听按钮要告诉人「点下去要花多久」。按字数估算会离谱——
   * 一句「你瞅啥？」两秒八，一句邻里对骂六秒半，差三倍。没有 ffprobe 的
   * 机器上这个字段会缺，界面据此不显示秒数，而不是显示一个编的数字。
   */
  durationMs?: number;
}

/**
 * 一次演绎：**一个人（或一个 AI）对一场戏的一遍**，可以只录一部分。
 *
 * 原名 Take，2026-09-05 改名并放宽，因为旧模型有两个表达不了的东西：
 *
 * 1. **一个地方只能有一份。** 旧模型的键是 (场景 × 方言)，所以「武城的三个人
 *    各说各的」写不下去。但一个母语者不是 ground truth——owner 本人是武城人，
 *    他说「感觉我一个人说的也不对」。个人语感有代际差、村落差、记性差。
 *    解法不是去找更权威的人，是**允许同一格有多个答案，并把分歧摆出来**。
 *    三个武城人填三个说法不是数据脏了，是真实信息。
 *
 * 2. **必须录完整场戏。** 旧校验要求 lines 覆盖全部拍。但实际投稿记录显示：
 *    六拍两角色的戏，owner 自己只录了 kid 那一个角色的两拍就停了——那不是
 *    偷懒，是**一个人只演得了一个人**。半场戏该算「已认领一半」，不是「未完成」。
 *
 * 身份是**二选一**：AI 演绎挂方言区（dialectId），真人贡献挂行政区划
 * （placeCode）。不能都有，也不能都没有——这条由 validateContent 强制。
 * 两者不对称是故意的：AI 只能到区级抽象，真人永远是某个具体的县。
 */
/**
 * 代际。**这是这个站唯一一根时间轴。**
 *
 * 方言的差异不只在地图上，也在同一个家里的两代人之间——而后者才是这件事
 * 真正的情绪所在：语言消失不是发生在省与省之间，是发生在你和你爸妈之间。
 *
 * 语保工程结构上给不出这个：它的方法论是「每个调查点选一名合格发音人」，
 * 一点一个答案，代际差被方法本身抹掉了。我们允许一个地方有多份演绎，所以
 * 顺手就能有这根轴——只多问一个可选字段。
 *
 * 可选，永远可选。问年龄本身就是门槛，为了一根轴把人挡在外面不划算。
 */
export const AGE_BANDS = ['pre70', '70s', '80s', '90s', '00s'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_LABELS: Record<AgeBand, string> = {
  pre70: '70 前',
  '70s': '70 后',
  '80s': '80 后',
  '90s': '90 后',
  '00s': '00 后',
};

export interface Take {
  id: string;
  sceneId: string;
  /** AI 演绎的归属：方言节点。与 placeCode 互斥 */
  dialectId?: string;
  /** 真人贡献的归属：县级行政区划代码。与 dialectId 互斥 */
  placeCode?: string;
  source: TakeSource;
  verification: Verification;
  /** 文字与录音的对应程度；不填等于 verbatim。真人录音一般是 approximate */
  transcript?: Transcript;
  contributor?: string;
  /** 说话人的代际。可选——问年龄本身就是门槛 */
  age?: AgeBand;
  verifier?: string;
  /** 这一遍录到的拍。真人可以只录一部分；AI 必须录全 */
  lines: TakeLine[];
}

/** 同一场戏、同一个身份可以有多份 Take，靠这个键区分 */
export function takeIdentity(t: Take): string {
  return t.dialectId ?? t.placeCode ?? '';
}
