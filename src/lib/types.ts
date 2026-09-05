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

export const PERFORMANCE_SOURCES = ['tts', 'human'] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

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

export interface PerformanceLine {
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

export interface Performance {
  id: string;
  sceneId: string;
  dialectId: string;
  source: PerformanceSource;
  verification: Verification;
  /** 文字与录音的对应程度；不填等于 verbatim。真人录音一般是 approximate */
  transcript?: Transcript;
  contributor?: string;
  verifier?: string;
  lines: PerformanceLine[];
}
