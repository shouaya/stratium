export type AppLocale = "zh" | "ja" | "en";

type RequestLike = {
  headers: {
    "x-stratium-locale"?: string | string[] | undefined;
    "accept-language"?: string | string[] | undefined;
  };
};

type MessageSet = {
  auth: {
    loginRequired: string;
    loginRequiredForFrontend: string;
    loginRequiredForAdmin: string;
    invalidCredentials: string;
    loginFieldsRequired: string;
  };
  admin: {
    createUserFieldsRequired: string;
    batchJobRequestFailed: string;
    maintenanceActive: string;
    manualTicksDisabled: string;
    tradingDisabled: string;
  };
  trading: {
    leverageMustBeNumber: string;
    leverageMin: string;
    leverageWrongSymbol: string;
    leverageMax: (max: number, symbol: string) => string;
  };
  runtime: Record<string, string>;
};

const MESSAGES: Record<AppLocale, MessageSet> = {
  zh: {
    auth: {
      loginRequired: "需要先登录。",
      loginRequiredForFrontend: "需要以前端用户登录。",
      loginRequiredForAdmin: "需要以管理员登录。",
      invalidCredentials: "账号或密码错误。",
      loginFieldsRequired: "必须提供用户名、密码和角色。"
    },
    admin: {
      createUserFieldsRequired: "必须提供用户名、密码和显示名称。",
      batchJobRequestFailed: "批处理任务请求失败。",
      maintenanceActive: "系统维护中，前端接口暂时不可用。",
      manualTicksDisabled: "平台设置已禁用手动行情。",
      tradingDisabled: "平台设置已禁用前端交易。"
    },
    trading: {
      leverageMustBeNumber: "杠杆必须是数字。",
      leverageMin: "杠杆至少为 1x。",
      leverageWrongSymbol: "只能修改当前交易标的的杠杆。",
      leverageMax: (max, symbol) => `${symbol} 的杠杆不能超过 ${max}x。`
    },
    runtime: {
      "Manual tick symbol does not match the active market symbol.": "手动行情的 symbol 与当前激活市场不一致。",
      "Manual tick requires positive bid, ask, last, and spread values.": "手动行情的 bid、ask、last 和 spread 必须为正数。",
      "Manual tick requires bid lower than ask.": "手动行情要求 bid 小于 ask。",
      "Manual tick spread does not match bid/ask.": "手动行情的 spread 与 bid/ask 不匹配。",
      "Manual tick last price must stay between bid and ask.": "手动行情的 last 必须位于 bid 和 ask 之间。",
      "Manual tick last price is too far from the current market.": "手动行情的 last 与当前市场偏离过大。"
    }
  },
  ja: {
    auth: {
      loginRequired: "ログインが必要です。",
      loginRequiredForFrontend: "フロントエンドユーザーでログインしてください。",
      loginRequiredForAdmin: "管理者としてログインしてください。",
      invalidCredentials: "ユーザー名またはパスワードが正しくありません。",
      loginFieldsRequired: "username、password、role は必須です。"
    },
    admin: {
      createUserFieldsRequired: "username、password、displayName は必須です。",
      batchJobRequestFailed: "バッチジョブのリクエストに失敗しました。",
      maintenanceActive: "メンテナンス中のため、フロントエンド API は一時的に利用できません。",
      manualTicksDisabled: "プラットフォーム設定で手動ティックが無効です。",
      tradingDisabled: "プラットフォーム設定でフロントエンド取引が無効です。"
    },
    trading: {
      leverageMustBeNumber: "レバレッジは数値である必要があります。",
      leverageMin: "レバレッジは最低 1x です。",
      leverageWrongSymbol: "アクティブな取引シンボルのレバレッジのみ変更できます。",
      leverageMax: (max, symbol) => `${symbol} のレバレッジは最大 ${max}x です。`
    },
    runtime: {
      "Manual tick symbol does not match the active market symbol.": "手動ティックのシンボルが現在の市場シンボルと一致しません。",
      "Manual tick requires positive bid, ask, last, and spread values.": "手動ティックの bid、ask、last、spread は正の値である必要があります。",
      "Manual tick requires bid lower than ask.": "手動ティックでは bid は ask より低い必要があります。",
      "Manual tick spread does not match bid/ask.": "手動ティックの spread が bid/ask と一致しません。",
      "Manual tick last price must stay between bid and ask.": "手動ティックの last は bid と ask の間である必要があります。",
      "Manual tick last price is too far from the current market.": "手動ティックの last が現在市場から離れすぎています。"
    }
  },
  en: {
    auth: {
      loginRequired: "Login required.",
      loginRequiredForFrontend: "Login required for frontend.",
      loginRequiredForAdmin: "Login required for admin.",
      invalidCredentials: "Invalid credentials.",
      loginFieldsRequired: "username, password, and role are required."
    },
    admin: {
      createUserFieldsRequired: "username, password, and displayName are required.",
      batchJobRequestFailed: "Batch job request failed.",
      maintenanceActive: "The API is temporarily unavailable during maintenance.",
      manualTicksDisabled: "Manual ticks are disabled by platform settings.",
      tradingDisabled: "Trading is disabled by platform settings."
    },
    trading: {
      leverageMustBeNumber: "Leverage must be a number.",
      leverageMin: "Leverage must be at least 1x.",
      leverageWrongSymbol: "Leverage can only be updated for the active trading symbol.",
      leverageMax: (max, symbol) => `Leverage exceeds max ${max}x for ${symbol}.`
    },
    runtime: {
      "Manual tick symbol does not match the active market symbol.": "Manual tick symbol does not match the active market symbol.",
      "Manual tick requires positive bid, ask, last, and spread values.": "Manual tick requires positive bid, ask, last, and spread values.",
      "Manual tick requires bid lower than ask.": "Manual tick requires bid lower than ask.",
      "Manual tick spread does not match bid/ask.": "Manual tick spread does not match bid/ask.",
      "Manual tick last price must stay between bid and ask.": "Manual tick last price must stay between bid and ask.",
      "Manual tick last price is too far from the current market.": "Manual tick last price is too far from the current market."
    }
  }
};

const pickFirst = (value: string | string[] | undefined): string | undefined => Array.isArray(value) ? value[0] : value;

export const resolveLocale = (request: RequestLike): AppLocale => {
  const explicit = pickFirst(request.headers["x-stratium-locale"])?.trim().toLowerCase();
  if (explicit === "zh" || explicit === "ja" || explicit === "en") {
    return explicit;
  }

  const acceptLanguage = pickFirst(request.headers["accept-language"])?.toLowerCase() ?? "";
  if (acceptLanguage.startsWith("zh")) {
    return "zh";
  }
  if (acceptLanguage.startsWith("ja")) {
    return "ja";
  }
  return "en";
};

export const getMessages = (locale: AppLocale): MessageSet => MESSAGES[locale];

export const localizeRuntimeMessage = (locale: AppLocale, message: string): string =>
  MESSAGES[locale].runtime[message] ?? message;
