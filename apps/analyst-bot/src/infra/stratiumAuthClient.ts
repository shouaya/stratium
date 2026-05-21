export type StratiumAdminLoginResult = {
  token: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
};

export const loginToStratiumAdmin = async (input: {
  apiBaseUrl: string;
  account: string;
  password: string;
}): Promise<StratiumAdminLoginResult> => {
  const response = await fetch(`${input.apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: input.account,
      password: input.password,
      role: "admin"
    })
  });
  const payload = await response.json().catch(() => ({})) as {
    token?: string;
    user?: StratiumAdminLoginResult["user"];
    message?: string;
  };

  if (!response.ok || !payload.token || !payload.user || payload.user.role !== "admin") {
    throw new Error(payload.message ?? `Failed to login to Stratium API with status ${response.status}`);
  }

  return {
    token: payload.token,
    user: payload.user
  };
};
