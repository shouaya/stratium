export type StratiumLoginResult = {
  token: string;
  user: {
    id: string;
    username: string;
    role: string;
    tradingAccountId?: string | null;
  };
};

export const loginToStratium = async (input: {
  apiBaseUrl: string;
  account: string;
  password: string;
}): Promise<StratiumLoginResult> => {
  const response = await fetch(`${input.apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: input.account,
      password: input.password,
      role: "frontend"
    })
  });
  const payload = await response.json().catch(() => ({})) as { token?: string; user?: StratiumLoginResult["user"]; message?: string };

  if (!response.ok || !payload.token || !payload.user) {
    throw new Error(payload.message ?? `Failed to login to Stratium API with status ${response.status}`);
  }

  return {
    token: payload.token,
    user: payload.user
  };
};
