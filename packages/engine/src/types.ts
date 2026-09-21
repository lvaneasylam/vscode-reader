/**
 * legado 书源类型定义，字段名与 legado BookSource JSON 保持一致。
 * 对照源码：app/src/main/java/io/legado/app/data/entities/BookSource.kt 及 rule/*.kt
 * 第一版仅声明文本源（bookSourceType=0）流程所需字段，未知字段保留不丢弃。
 */

export interface SearchRule {
  checkKeyWord?: string
  bookList?: string
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  updateTime?: string
  bookUrl?: string
  coverUrl?: string
  wordCount?: string
}

export interface BookInfoRule {
  init?: string
  name?: string
  author?: string
  intro?: string
  kind?: string
  lastChapter?: string
  updateTime?: string
  coverUrl?: string
  tocUrl?: string
  wordCount?: string
  canReName?: string
  downloadUrls?: string
}

export interface TocRule {
  chapterList?: string
  chapterName?: string
  chapterUrl?: string
  formatJs?: string
  isVolume?: string
  isVip?: string
  isPay?: string
  updateTime?: string
  nextTocUrl?: string
}

export interface ContentRule {
  content?: string
  subContent?: string
  title?: string
  nextContentUrl?: string
  webJs?: string
  sourceRegex?: string
  replaceRegex?: string
  imageStyle?: string
  imageDecode?: string
  payAction?: string
  callBackJs?: string
}

export interface ExploreRule {
  bookList?: string
  [key: string]: string | undefined
}

export interface BookSource {
  /** 地址（主键） */
  bookSourceUrl: string
  bookSourceName: string
  bookSourceGroup?: string
  /** 0 文本，1 音频，2 图片，3 文件，4 视频 */
  bookSourceType?: number
  /** 详情页 url 正则 */
  bookUrlPattern?: string
  enabled?: boolean
  enabledExplore?: boolean
  enabledCookieJar?: boolean
  concurrentRate?: string
  /** 请求头（原始 JSON 字符串或对象，加载后规范化进 headerMap） */
  header?: unknown
  /** 规范化后的请求头 */
  headerMap: Record<string, string>
  jsLib?: string
  loginUrl?: string
  loginUi?: unknown
  loginCheckJs?: string
  variableComment?: string
  exploreUrl?: string
  ruleExplore?: ExploreRule
  searchUrl?: string
  ruleSearch?: SearchRule
  ruleBookInfo?: BookInfoRule
  ruleToc?: TocRule
  ruleContent?: ContentRule
  /** 导入时保留的未知字段 */
  [key: string]: unknown
}

/** 搜索结果条目 */
export interface SearchBook {
  name: string
  author: string
  bookUrl: string
  intro?: string
  kind?: string
  lastChapter?: string
  coverUrl?: string
  /** 所属书源地址 */
  origin: string
  originName: string
}

/** 书架条目（持久化） */
export interface ShelfBook {
  bookUrl: string
  name: string
  author: string
  /** 目录页地址（详情页规则提取；无则等于 bookUrl） */
  tocUrl: string
  origin: string
  originName: string
  /** 阅读进度：当前章节索引 */
  chapterIndex: number
  /** 章节总数缓存 */
  chapterCount?: number
}

/** 章节条目 */
export interface BookChapter {
  title: string
  url: string
  index: number
  isVolume?: boolean
  isVip?: boolean
}
