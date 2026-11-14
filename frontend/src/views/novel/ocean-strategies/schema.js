// 策略表单的分区和字段。顺序对齐巨量「新建项目」：
// 营销目标与场景 → 投放内容与目标 → 用户定向 → 排期与预算 → 项目名称 → 广告素材。
// 调整先后、文案或可选项只改这里。新增选项时，同步 backend/services/oceanengineLaunch.js 的枚举白名单，搭建才会按所选值提交。

export const STRATEGY_SECTIONS = [
  {
    key: "meta",
    title: "策略",
    fields: [
      {
        key: "name",
        label: "策略名称",
        widget: "name",
        maxlength: 40,
        placeholder: "例如 点众-倾心书馆",
        hint: "用来区分模板，不传给巨量。默认带小程序名，可改成「版权-小程序」。",
      },
    ],
  },
  {
    key: "scene",
    title: "营销目标与场景",
    fields: [
      {
        key: "landingType",
        label: "营销目的",
        widget: "select",
        default: "MICRO_GAME",
        options: [{ value: "MICRO_GAME", label: "小程序" }],
      },
      {
        key: "marketingGoal",
        label: "营销场景",
        widget: "select",
        default: "VIDEO_AND_IMAGE",
        options: [{ value: "VIDEO_AND_IMAGE", label: "短视频+图文" }],
      },
      {
        key: "microAppId",
        label: "投放载体",
        widget: "miniApp",
      },
      {
        key: "nativeType",
        label: "投放身份",
        widget: "select",
        default: "AWEME",
        options: [
          { value: "AWEME", label: "抖音号" },
          { value: "ACCOUNT", label: "账户信息" },
        ],
        hint: "对应智擎「投放身份」。选抖音号后，用下面拉到的授权号。",
      },
      {
        key: "awemeId",
        label: "抖音号",
        widget: "aweme",
        default: "",
        when: (form) => form.nativeType !== "ACCOUNT",
      },
    ],
  },
  {
    key: "content",
    title: "投放内容与目标",
    fields: [
      {
        key: "goal",
        label: "优化目标",
        widget: "select",
        default: "付费ROI",
        options: [
          { value: "付费ROI", label: "付费 + 付费ROI" },
          { value: "付费", label: "付费" },
        ],
      },
      {
        key: "deliveryMode",
        label: "投放模式",
        widget: "select",
        default: "PROCEDURAL",
        options: [{ value: "PROCEDURAL", label: "自动投放（智擎）" }],
      },
      {
        key: "adType",
        label: "项目类型",
        widget: "select",
        default: "ALL",
        options: [{ value: "ALL", label: "通投广告" }],
      },
      {
        key: "productSetting",
        label: "关联产品",
        widget: "select",
        default: "SINGLE",
        options: [{ value: "SINGLE", label: "商品（搭建任务时选商品库）" }],
      },
      {
        key: "inventoryCatalog",
        label: "投放位置",
        widget: "select",
        default: "UNIVERSAL_SMART",
        options: [{ value: "UNIVERSAL_SMART", label: "通投智选" }],
      },
    ],
  },
  {
    key: "audience",
    title: "用户定向",
    hint: "基础定向默认不限。",
    fields: [
      {
        key: "audienceType",
        label: "基础定向",
        widget: "select",
        default: "UNLIMITED",
        options: [
          { value: "UNLIMITED", label: "不限" },
          { value: "CUSTOM", label: "自定义" },
        ],
      },
      {
        key: "gender",
        label: "性别",
        widget: "select",
        default: "GENDER_UNLIMITED",
        when: (form) => form.audienceType === "CUSTOM",
        options: [
          { value: "GENDER_UNLIMITED", label: "不限" },
          { value: "GENDER_MALE", label: "男" },
          { value: "GENDER_FEMALE", label: "女" },
        ],
      },
      {
        key: "age",
        label: "年龄",
        widget: "multi",
        default: [],
        placeholder: "不限",
        when: (form) => form.audienceType === "CUSTOM",
        options: [
          { value: "AGE_BETWEEN_18_23", label: "18-23" },
          { value: "AGE_BETWEEN_24_30", label: "24-30" },
          { value: "AGE_BETWEEN_31_40", label: "31-40" },
          { value: "AGE_BETWEEN_41_49", label: "41-49" },
          { value: "AGE_ABOVE_50", label: "50+" },
        ],
      },
      {
        key: "district",
        label: "地域",
        widget: "select",
        default: "NONE",
        when: (form) => form.audienceType === "CUSTOM",
        options: [{ value: "NONE", label: "不限" }],
      },
      {
        key: "hideIfConverted",
        label: "过滤已转化",
        widget: "select",
        default: "NO_EXCLUDE",
        options: [
          { value: "NO_EXCLUDE", label: "不限" },
          { value: "PROJECT", label: "项目" },
          { value: "PROMOTION", label: "单元" },
          { value: "ADVERTISER", label: "投放账户" },
          { value: "CUSTOMER", label: "客户" },
          { value: "APP", label: "应用" },
          { value: "ORGANIZATION", label: "组织" },
        ],
      },
      {
        key: "hideIfExists",
        label: "过滤已安装",
        widget: "select",
        default: "UNLIMITED",
        options: [
          { value: "UNLIMITED", label: "不限" },
          { value: "FILTER", label: "过滤" },
          { value: "TARGETING", label: "定向" },
        ],
      },
    ],
  },
  {
    key: "budget",
    title: "排期与预算",
    hint: "从今天起长期投放，全时段。",
    note: "每次不一样的是户、商品、链接、出价、项目名，其它都用这套策略。",
    fields: [
      {
        key: "bidStrategyId",
        label: "出价策略",
        widget: "bidStrategy",
        hint: "选一套后，下面列出模板对应出价。",
      },
      {
        key: "scheduleType",
        label: "投放时间",
        widget: "select",
        default: "SCHEDULE_FROM_NOW",
        options: [{ value: "SCHEDULE_FROM_NOW", label: "从今天起长期投放" }],
      },
      {
        key: "bidType",
        label: "竞价策略",
        widget: "select",
        default: "CUSTOM",
        options: [{ value: "CUSTOM", label: "稳定成本" }],
      },
      {
        key: "budget",
        label: "日预算",
        widget: "number",
        default: 9999,
        min: 300,
        max: 9999999,
        step: 1,
      },
      {
        key: "roiGoal",
        label: "ROI 系数",
        widget: "number",
        default: 1.28,
        min: 0.01,
        max: 5,
        step: 0.01,
        precision: 2,
        when: (form) => form.goal !== "付费",
      },
    ],
  },
  {
    key: "naming",
    title: "项目名称",
    fields: [
      {
        key: "namePattern",
        label: "项目命名",
        widget: "namePattern",
        default: "{日期}{版权方}-{书名}-{档位}",
        maxlength: 80,
        placeholder: "{日期}{版权方}-{书名}-{档位}",
        tokens: ["{日期}", "{版权方}", "{书名}", "{档位}"],
      },
    ],
  },
  {
    key: "creative",
    title: "广告素材",
    hint: "搭建时按书名把匹配到的素材全部带进计划，单次最多 200 条。",
    fields: [
      {
        key: "source",
        label: "抖音号昵称",
        widget: "text",
        maxlength: 10,
        placeholder: "例如 倾心书馆",
        hint: "对应智擎广告来源，2 到 10 个字。和上面的抖音号不是同一个字段。",
      },
      {
        key: "titleLibraryId",
        label: "标题包",
        widget: "titleLibrary",
        hint: "搭建时默认用这个包，每个计划随机抽最多 30 条。投放页还可以改。",
      },
      {
        key: "productName",
        label: "产品名称",
        widget: "text",
        maxlength: 20,
        placeholder: "例如 2026高分小说",
        hint: "对应智擎产品名称，搭建时写进产品信息。",
      },
      {
        key: "sellingPointsText",
        label: "产品卖点",
        widget: "textarea",
        rows: 8,
        placeholder: "一行一条，6 到 9 个字，最多 10 条",
        hint: "对应智擎产品卖点，重复的会自动去掉。搭建时全部带上。",
      },
      {
        key: "callToActionsText",
        label: "行动号召",
        widget: "textarea",
        rows: 6,
        placeholder: "一行一条，2 到 4 个字，最多 10 条",
        hint: "对应智擎行动号召，重复的会自动去掉。搭建时全部带上。",
      },
      {
        key: "comment",
        label: "评论管理",
        widget: "select",
        default: "OFF",
        options: [
          { value: "OFF", label: "不启用" },
          { value: "ON", label: "启用" },
        ],
      },
      {
        key: "aigc",
        label: "AIGC 动态创意",
        widget: "select",
        default: "OFF",
        options: [
          { value: "OFF", label: "关闭" },
          { value: "ON", label: "开启" },
        ],
      },
    ],
  },
]

export function strategyFieldDefaults() {
  const values = {}
  for (const section of STRATEGY_SECTIONS) {
    for (const field of section.fields) {
      if (!Object.prototype.hasOwnProperty.call(field, "default")) continue
      values[field.key] = Array.isArray(field.default) ? field.default.slice() : field.default
    }
  }
  return values
}
