"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GasApiError, callGasApi } from "@/lib/gasApi";

type AuthState =
  | "checking"
  | "signed_out"
  | "authorizing"
  | "signed_in"
  | "denied"
  | "error";

type JwtPayload = {
  email?: string;
  name?: string;
  picture?: string;
};

type UserInfo = {
  email: string;
  name: string;
  picture?: string;
};

type SessionCreateResult = {
  ok: boolean;
  now: string;
  sessionToken: string;
  expiresIn: number;
};

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: Record<string, string | number | boolean>,
      ) => void;
      prompt: () => void;
      cancel: () => void;
      revoke: (hint: string, callback: () => void) => void;
      disableAutoSelect: () => void;
    };
  };
};

const gasUrl = process.env.NEXT_PUBLIC_GAS_WEBAPP_URL;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

function base64UrlDecode(value: string): string {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

function parseJwt(credential: string): JwtPayload | null {
  const sections = credential.split(".");
  if (sections.length < 2) return null;

  try {
    return JSON.parse(base64UrlDecode(sections[1])) as JwtPayload;
  } catch {
    return null;
  }
}

function toUserMessage(error: unknown): string {
  if (!(error instanceof GasApiError)) {
    return "認証処理に失敗しました。時間をおいて再実行してください。";
  }

  if (error.status === 401) {
    return "認証に失敗しました。Googleで再ログインしてください。";
  }
  if (error.status === 403) {
    return "このGoogleアカウントにはアクセス権限がありません。";
  }
  if (error.status === 0) {
    return "ネットワークエラーが発生しました。接続を確認してください。";
  }

  return error.message || "サーバーとの通信に失敗しました。";
}

export default function Page() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [apiResult, setApiResult] = useState<SessionCreateResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const buttonRef = useRef<HTMLDivElement | null>(null);

  const iframeSrc = useMemo(() => {
    if (!gasUrl || !sessionToken) return "";
    const sep = gasUrl.includes("?") ? "&" : "?";
    return `${gasUrl}${sep}st=${encodeURIComponent(sessionToken)}`;
  }, [sessionToken]);

  const handleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setAuthState("error");
      setErrorMessage("Googleからトークンを受け取れませんでした。");
      return;
    }

    const payload = parseJwt(response.credential);
    if (!payload?.email) {
      setAuthState("error");
      setErrorMessage("Googleアカウント情報の読み取りに失敗しました。");
      return;
    }

    setAuthState("authorizing");
    setErrorMessage("");

    try {
      const gasResponse = await callGasApi<SessionCreateResult>(response.credential, "createSession", {});
      setUser({
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture,
      });
      setApiResult(gasResponse.data);
      setSessionToken(gasResponse.data.sessionToken);
      setAuthState("signed_in");
    } catch (error) {
      setUser(null);
      setApiResult(null);
      setSessionToken("");
      setAuthState(error instanceof GasApiError && error.status === 403 ? "denied" : "error");
      setErrorMessage(toUserMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!googleClientId) {
      setAuthState("error");
      setErrorMessage("NEXT_PUBLIC_GOOGLE_CLIENT_ID が未設定です。");
      return;
    }

    if (!scriptReady || authState === "signed_in" || authState === "authorizing" || !buttonRef.current) {
      return;
    }

    const google = (window as Window & { google?: GoogleIdentity }).google;
    if (!google) return;

    buttonRef.current.innerHTML = "";
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (credentialResponse) => {
        void handleCredential(credentialResponse);
      },
    });
    google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      width: 280,
      text: "signin_with",
    });
    google.accounts.id.prompt();
    if (authState === "checking") setAuthState("signed_out");

    return () => {
      google.accounts.id.cancel();
    };
  }, [authState, handleCredential, scriptReady]);

  const handleSignOut = () => {
    const google = (window as Window & { google?: GoogleIdentity }).google;
    if (google && user?.email) google.accounts.id.revoke(user.email, () => {});
    if (google) google.accounts.id.disableAutoSelect();
    setUser(null);
    setApiResult(null);
    setSessionToken("");
    setErrorMessage("");
    setAuthState("signed_out");
  };

  return (
    <main className="page">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />

      {!gasUrl ? (
        <section className="notice">
          <h2>GAS URL が未設定です</h2>
          <p>
            <code>NEXT_PUBLIC_GAS_WEBAPP_URL</code> にデプロイ済み Web アプリ URL を設定してください。
          </p>
        </section>
      ) : !googleClientId ? (
        <section className="notice">
          <h2>Google Client ID が未設定です</h2>
          <p>
            <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> を設定してください。
          </p>
        </section>
      ) : authState !== "signed_in" ? (
        <section className="notice">
          <h2>Google ログインが必要です</h2>
          <p className="noticeText">ログイン成功後に id_token を Next.js サーバー経由で GAS へ POST します。</p>
          <div ref={buttonRef} className="googleButton" />
          {authState === "authorizing" ? <p className="noticeText">認証中...</p> : null}
          {authState === "denied" || authState === "error" ? (
            <p className="noticeError">{errorMessage}</p>
          ) : null}
        </section>
      ) : (
        <section className="frameWrap">
          <div className="userBar">
            <div className="userMeta">
              {user?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt={user.name} className="avatar" />
              ) : null}
              <div>
                <strong>{user?.name}</strong>
                <p>{user?.email}</p>
              </div>
            </div>
            <button type="button" onClick={handleSignOut} className="signOutButton">
              Sign out
            </button>
          </div>

          <p className="noticeText">
            API認証結果: {apiResult ? JSON.stringify({ ok: apiResult.ok, now: apiResult.now, expiresIn: apiResult.expiresIn }) : "未取得"}
          </p>

          {iframeSrc ? (
            <iframe
              src={iframeSrc}
              title="GAS Web App"
              className="frame"
              loading="lazy"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <p className="noticeError">iframe セッションが取得できませんでした。</p>
          )}
        </section>
      )}

      <footer className="footer">
        <p>id_token は URL や localStorage に保存せず、ログイン直後にサーバー経由で送信しています。</p>
      </footer>
    </main>
  );
}
