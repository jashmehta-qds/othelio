"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import {
  API_BASE_URL,
  checkApiHealth,
  fetchAgentSettingsApi,
  updateAgentSettingsApi,
  generateAgentApiKeyApi,
  revokeAgentApiKeyApi,
  fetchAgentProposalsApi,
  type AgentSettings,
  type AgentProposalItem,
} from "@/lib/api";
import styles from "./AgentsPage.module.css";

const ALL_POSSIBLE_ASSETS = [
  "USDC",
  "AAPLc",
  "MSFTc",
  "NVDAc",
  "GOOGLc",
  "AMZNc",
  "METAc",
  "TSLAc",
  "MSTRc",
  "SPCXc",
  "SNDKc",
];

function checkIsMarketOpen(): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

    const isWeekday = weekday !== "Sat" && weekday !== "Sun";
    const minutesSinceMidnight = hour * 60 + minute;
    // 9:30 AM = 570 mins, 4:00 PM = 960 mins
    return isWeekday && minutesSinceMidnight >= 570 && minutesSinceMidnight < 960;
  } catch {
    return false;
  }
}

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { token, isAuthenticated, isAuthenticating, login } = useAuth();

  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [proposals, setProposals] = useState<AgentProposalItem[]>([]);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(false);
  const [isApiOnline, setIsApiOnline] = useState<boolean | null>(null);

  // Guardrails form states
  const [autonomyTier, setAutonomyTier] = useState<"staged" | "advisory">("staged");
  const [maxSpendPerTx, setMaxSpendPerTx] = useState<number>(500);
  const [dailySpendLimit, setDailySpendLimit] = useState<number>(2000);
  const [maxSlippageBps, setMaxSlippageBps] = useState<number>(50);
  const [restrictToMarketHours, setRestrictToMarketHours] = useState<boolean>(true);
  const [minRebalanceDriftBps, setMinRebalanceDriftBps] = useState<number>(300);
  const [allowedAssets, setAllowedAssets] = useState<string[]>(ALL_POSSIBLE_ASSETS);

  // Modals & interaction states
  const [newKeyModal, setNewKeyModal] = useState<{ apiKey: string } | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [activeSetupTab, setActiveSetupTab] = useState<"claude" | "cursor" | "chatgpt" | "curl">("claude");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [savingPermissions, setSavingPermissions] = useState<boolean>(false);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    setIsMarketOpen(checkIsMarketOpen());
    const interval = setInterval(() => {
      setIsMarketOpen(checkIsMarketOpen());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;
    const verifyApi = async () => {
      const online = await checkApiHealth();
      if (mounted) setIsApiOnline(online);
    };
    verifyApi();
    const interval = setInterval(verifyApi, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const loadAgentData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const lowerAddr = address.toLowerCase();
      const [settingsRes, proposalsRes] = await Promise.all([
        fetchAgentSettingsApi(lowerAddr).catch(() => null),
        fetchAgentProposalsApi(lowerAddr).catch(() => null),
      ]);

      if (settingsRes?.data) {
        const s = settingsRes.data;
        setSettings(s);
        setAutonomyTier(s.autonomyTier || "staged");
        setMaxSpendPerTx(s.maxSpendPerTxUsd || 500);
        setDailySpendLimit(s.dailySpendLimitUsd || 2000);
        setMaxSlippageBps(s.maxSlippageBps || 50);
        setRestrictToMarketHours(s.restrictToMarketHours ?? true);
        setMinRebalanceDriftBps(s.minRebalanceDriftBps || 300);
        setAllowedAssets(s.allowedAssets || ALL_POSSIBLE_ASSETS);
      }

      if (proposalsRes?.data) {
        setProposals(proposalsRes.data);
      }
    } catch (err) {
      console.error("Failed to load agent data:", err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      loadAgentData();
    }
  }, [address, loadAgentData]);

  const handleConnectAgent = async () => {
    if (!address || !token) {
      triggerToast("Please authenticate with wallet first.");
      return;
    }
    setLoading(true);
    try {
      const res = await generateAgentApiKeyApi(address, token);
      if (res?.data?.apiKey) {
        setNewKeyModal({ apiKey: res.data.apiKey });
        await loadAgentData();
        triggerToast("Agent credentials generated successfully.");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to generate agent key.";
      triggerToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectAgent = async () => {
    if (!address || !token) return;
    setLoading(true);
    try {
      await revokeAgentApiKeyApi(address, token);
      setShowDisconnectModal(false);
      await loadAgentData();
      triggerToast("Agent credentials revoked. Access disconnected.");
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to disconnect agent.";
      triggerToast(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!address || !token) {
      triggerToast("Wallet authentication required to update guardrails.");
      return;
    }
    if (dailySpendLimit < maxSpendPerTx) {
      triggerToast("Daily spend budget cannot be less than per-transaction ceiling.");
      return;
    }

    setSavingPermissions(true);
    try {
      await updateAgentSettingsApi(
        address,
        {
          autonomyTier,
          maxSpendPerTxUsd: maxSpendPerTx,
          dailySpendLimitUsd: dailySpendLimit,
          maxSlippageBps,
          restrictToMarketHours,
          minRebalanceDriftBps,
          allowedAssets,
        },
        token,
      );
      triggerToast("Financial guardrails updated on-chain & backend.");
      await loadAgentData();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to update guardrails.";
      triggerToast(errorMsg);
    } finally {
      setSavingPermissions(false);
    }
  };

  const toggleAsset = (symbol: string) => {
    if (allowedAssets.includes(symbol)) {
      if (allowedAssets.length <= 1) {
        triggerToast("At least one asset must remain whitelisted.");
        return;
      }
      setAllowedAssets(allowedAssets.filter((a) => a !== symbol));
    } else {
      setAllowedAssets([...allowedAssets, symbol]);
    }
  };

  const copyToClipboard = (text: string, type: "key" | "snippet") => {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
    triggerToast("Copied to clipboard.");
  };

  const claudeConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        othelio: {
          command: "npx",
          args: ["-y", "@othelio/mcp"],
          env: {
            OTHELIO_API_URL: API_BASE_URL,
            OTHELIO_AGENT_KEY: settings?.maskedApiKey || "YOUR_AGENT_KEY_HERE",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className={styles.container}>
      {/* Toast Notification */}
      {toastMessage && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "28px",
            right: "28px",
            background: "#121410",
            border: "1px solid #d7ff46",
            color: "#d7ff46",
            padding: "10px 18px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 600,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#d7ff46" }} />
          {toastMessage}
        </aside>
      )}

      {/* Live Telemetry Rail */}
      <nav aria-label="System status telemetry" className={styles.telemetryRail}>
        <div className={styles.telemetryGroup}>
          <div className={styles.telemetryItem}>
            <span className={`${styles.statusDot} ${isMarketOpen ? styles.statusDotOpen : styles.statusDotClosed}`} />
            NYSE Equities: <strong>{isMarketOpen ? "OPEN (9:30-16:00 ET)" : "CLOSED"}</strong>
          </div>
          <div className={styles.telemetryItem}>
            <span
              className={`${styles.statusDot} ${
                isApiOnline === true
                  ? styles.statusDotOpen
                  : isApiOnline === false
                  ? styles.statusDotClosed
                  : styles.statusDotActive
              }`}
            />
            API Gateway: <strong>{isApiOnline === true ? "Online" : isApiOnline === false ? "Offline / Starting" : "Connecting..."}</strong>
          </div>
          <div className={styles.telemetryItem}>
            <span className={`${styles.statusDot} ${styles.statusDotActive}`} />
            Network: <strong>Base Mainnet (8453)</strong>
          </div>
          <div className={styles.telemetryItem}>
            <span className={`${styles.statusDot} ${styles.statusDotActive}`} />
            Execution Router: <strong>Aerodrome Slipstream V3</strong>
          </div>
        </div>
        <div className={styles.telemetryGroup}>
          <div className={styles.telemetryItem}>
            Security Mode: <strong>Non-Custodial / Owner Signed</strong>
          </div>
        </div>
      </nav>

      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div>
          <h1>Connected Agents</h1>
          <p>
            Connect and govern AI agents (Claude, ChatGPT, Cursor, trading bots) through non-custodial
            Model Context Protocol endpoints with strict financial guardrails.
          </p>
        </div>

        <div className={styles.headerActions}>
          <a
            href={`${API_BASE_URL}/reference`}
            target="_blank"
            rel="noreferrer"
            className={styles.scalarLink}
            title={`Scalar OpenAPI Interactive Reference (${API_BASE_URL}/reference)`}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: isApiOnline === true ? "#22c55e" : isApiOnline === false ? "#ff7770" : "#d7ff46",
                display: "inline-block",
              }}
            />
            <span>Scalar API Reference</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </div>
      </header>

      {/* Wallet / Auth Gate */}
      {!isConnected ? (
        <div className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ width: "40px", height: "40px", margin: "0 auto 16px", color: "var(--muted-ink)" }}>
            <AppIcon type="lock" />
          </div>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
            Wallet Not Connected
          </h2>
          <p style={{ color: "var(--muted-ink)", fontSize: "13px", maxWidth: "420px", margin: "0 auto 20px" }}>
            Connect your Web3 wallet to manage connected AI agents, calibrate execution guardrails, or review staged proposals.
          </p>
          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            className={styles.btnPrimary}
          >
            Connect Wallet
          </button>
        </div>
      ) : !isAuthenticated ? (
        <div className={styles.card} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>
              Sign In to Manage Agent Permissions
            </h2>
            <p style={{ color: "var(--muted-ink)", fontSize: "12px", margin: 0 }}>
              Verify ownership of {address?.slice(0, 6)}...{address?.slice(-4)} via a gasless cryptographic signature.
            </p>
          </div>
          <button
            type="button"
            onClick={() => login()}
            disabled={isAuthenticating}
            className={styles.btnPrimary}
          >
            {isAuthenticating ? "Verifying..." : "Sign In with Wallet"}
          </button>
        </div>
      ) : (
        <>
          {/* Card 1: Connection Status & Identity */}
          <section className={styles.card}>
            {settings?.hasApiKey ? (
              /* CONNECTED STATE */
              <div>
                <div className={styles.cardHead}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span className={styles.badgeConnected}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d7ff46", display: "inline-block" }} />
                        Active Agent Connected
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontVariantNumeric: "tabular-nums" }}>
                        Updated {new Date(settings.updatedAt || Date.now()).toLocaleDateString()}
                      </span>
                    </div>
                    <h2>Agent Access Credentials</h2>
                    <p>API key hash active. Agent requests authenticate via the <code>X-Agent-Key</code> header.</p>
                  </div>

                  <div className={styles.keyActions}>
                    <button
                      type="button"
                      onClick={handleConnectAgent}
                      disabled={loading}
                      className={styles.btnSecondary}
                    >
                      Rotate Key
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDisconnectModal(true)}
                      disabled={loading}
                      className={styles.btnDanger}
                    >
                      Disconnect Agent
                    </button>
                  </div>
                </div>

                {/* Masked Key Display */}
                <div className={styles.credentialsBar}>
                  <div className={styles.keyIdentity}>
                    <label>KEY IDENTIFIER:</label>
                    <code>{settings.maskedApiKey || "oth_ag••••••••••••"}</code>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--muted-ink)" }}>
                    Stored securely as SHA-256 hash. Private keys never leave your device.
                  </span>
                </div>

                {/* Setup Instructions for Agent Runtimes */}
                <div className={styles.setupConsole}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                      Connect to Agent Environment
                    </h3>
                  </div>

                  <div className={styles.tabList}>
                    {[
                      { id: "claude", label: "Claude Desktop MCP" },
                      { id: "cursor", label: "Cursor IDE" },
                      { id: "chatgpt", label: "ChatGPT Action" },
                      { id: "curl", label: "cURL / Python" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveSetupTab(tab.id as "claude" | "cursor" | "chatgpt" | "curl")}
                        className={`${styles.tabButton} ${activeSetupTab === tab.id ? styles.tabButtonActive : ""}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activeSetupTab === "claude" && (
                    <div className={styles.codePanel}>
                      <div className={styles.codePanelHeader}>
                        <span>Add to ~/Library/Application Support/Claude/claude_desktop_config.json</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(claudeConfigSnippet, "snippet")}
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: copiedSnippet ? "#d7ff46" : "var(--ink)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {copiedSnippet ? "Copied!" : "Copy Configuration"}
                        </button>
                      </div>
                      <pre>{claudeConfigSnippet}</pre>
                    </div>
                  )}

                  {activeSetupTab === "cursor" && (
                    <div className={styles.codePanel}>
                      <div className={styles.codePanelHeader}>
                        <span>Settings &gt; Features &gt; MCP Servers</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`npx -y @othelio/mcp`, "snippet")}
                          style={{ fontSize: "11px", fontWeight: 600, color: copiedSnippet ? "#d7ff46" : "var(--ink)", background: "none", border: "none", cursor: "pointer" }}
                        >
                          {copiedSnippet ? "Copied!" : "Copy Command"}
                        </button>
                      </div>
                      <pre>{`Name: othelio
Type: command
Command: npx -y @othelio/mcp
Environment:
  OTHELIO_API_URL=${API_BASE_URL}
  OTHELIO_AGENT_KEY=${settings.maskedApiKey || "YOUR_AGENT_KEY"}`}</pre>
                    </div>
                  )}

                  {activeSetupTab === "chatgpt" && (
                    <div className={styles.codePanel}>
                      <div className={styles.codePanelHeader}>
                        <span>OpenAI Custom GPT &gt; Add Action &gt; Import OpenAPI Schema URL</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`${API_BASE_URL}/reference/openapi.json`, "snippet")}
                          style={{ fontSize: "11px", fontWeight: 600, color: copiedSnippet ? "#d7ff46" : "var(--ink)", background: "none", border: "none", cursor: "pointer" }}
                        >
                          {copiedSnippet ? "Copied!" : "Copy Schema URL"}
                        </button>
                      </div>
                      <pre>{`Schema URL: ${API_BASE_URL}/reference/openapi.json
Authentication: API Key
Header Name: X-Agent-Key`}</pre>
                    </div>
                  )}

                  {activeSetupTab === "curl" && (
                    <div className={styles.codePanel}>
                      <div className={styles.codePanelHeader}>
                        <span>Inspect Basket Composition &amp; Prices via REST</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`curl -X GET "${API_BASE_URL}/v1/agent/baskets" -H "X-Agent-Key: YOUR_AGENT_KEY"`, "snippet")}
                          style={{ fontSize: "11px", fontWeight: 600, color: copiedSnippet ? "#d7ff46" : "var(--ink)", background: "none", border: "none", cursor: "pointer" }}
                        >
                          {copiedSnippet ? "Copied!" : "Copy cURL"}
                        </button>
                      </div>
                      <pre>{`curl -X GET "${API_BASE_URL}/v1/agent/baskets" \\
  -H "X-Agent-Key: YOUR_AGENT_KEY"`}</pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* DISCONNECTED STATE */
              <div style={{ textAlign: "center", padding: "16px 8px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "rgba(215, 255, 70, 0.1)", border: "1px solid rgba(215, 255, 70, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "#d7ff46" }}>
                  <AppIcon type="agents" />
                </div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
                  Connect an AI Agent
                </h2>
                <p style={{ color: "var(--muted-ink)", fontSize: "13px", maxWidth: "480px", margin: "0 auto 20px", lineHeight: "1.5" }}>
                  Grant Claude, Cursor, ChatGPT, or autonomous bots scoped access to inspect your portfolio and stage bounded trades under your strict guardrails.
                </p>

                <div className={styles.blueprint}>
                  <div className={styles.blueprintStep}>
                    <h3>Non-Custodial Architecture</h3>
                    <p>Agents never hold private keys or custody assets. Every transaction requires your manual wallet signature.</p>
                  </div>
                  <div className={styles.blueprintStep}>
                    <h3>Server-Enforced Guardrails</h3>
                    <p>Hard limits on transaction size, daily budget, slippage, and whitelisted tokens are enforced before any quote is generated.</p>
                  </div>
                  <div className={styles.blueprintStep}>
                    <h3>Anti-Drain Protection</h3>
                    <p>Withdrawals and redemptions are strictly bound to your authenticated wallet address only. Third-party destinations are blocked.</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleConnectAgent}
                  disabled={loading}
                  className={styles.btnPrimary}
                  style={{ height: "40px", padding: "0 24px" }}
                >
                  {loading ? "Generating Credentials..." : "Authorize Agent & Generate API Key"}
                </button>
              </div>
            )}
          </section>

          {/* Card 2: Permissions & Financial Guardrails */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Execution Policies &amp; Financial Guardrails</h2>
                <p>
                  Deterministic guardrails enforced on every agent trade quote, basket deposit, and rebalance proposal.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSavePermissions}
                disabled={savingPermissions}
                className={styles.btnPrimary}
              >
                {savingPermissions ? "Saving..." : "Save Guardrails"}
              </button>
            </div>

            <div className={styles.policyGrid}>
              {/* Policy 1: Autonomy Mode */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Execution Autonomy Tier</strong>
                  <span>Controls whether the agent can stage signed transactions or only provide read-only market intelligence.</span>
                </div>
                <div className={styles.presetGroup}>
                  <button
                    type="button"
                    onClick={() => setAutonomyTier("staged")}
                    className={`${styles.presetPill} ${autonomyTier === "staged" ? styles.presetPillActive : ""}`}
                  >
                    Staged (Human-in-the-Loop)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutonomyTier("advisory")}
                    className={`${styles.presetPill} ${autonomyTier === "advisory" ? styles.presetPillActive : ""}`}
                  >
                    Advisory (Read-Only)
                  </button>
                </div>
              </div>

              {/* Policy 2: Max Spend per Transaction */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Max Spend per Transaction</strong>
                  <span>Absolute ceiling on any single deposit, trade, or rebalance proposal staged by the agent.</span>
                </div>
                <div className={styles.presetGroup}>
                  {[100, 250, 500, 1000, 2000].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setMaxSpendPerTx(val)}
                      className={`${styles.presetPill} ${maxSpendPerTx === val ? styles.presetPillActive : ""}`}
                    >
                      ${val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Policy 3: Daily Spend Budget & Live Meter */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Daily Spend Budget (24h Rolling)</strong>
                  <span>Total cumulative volume permitted per 24 hours. Resets automatically at 00:00 UTC.</span>
                </div>
                <div className={styles.presetGroup}>
                  {[500, 1000, 2000, 5000, 10000].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDailySpendLimit(val)}
                      className={`${styles.presetPill} ${dailySpendLimit === val ? styles.presetPillActive : ""}`}
                    >
                      ${val.toLocaleString()}
                    </button>
                  ))}
                </div>
                {settings && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-ink)", fontVariantNumeric: "tabular-nums" }}>
                      <span>Utilized Today:</span>
                      <strong>${settings.spentTodayUsd.toFixed(2)} / ${dailySpendLimit.toFixed(2)} USD</strong>
                    </div>
                    <div className={styles.meterTrack}>
                      <div
                        className={styles.meterFill}
                        style={{
                          width: `${Math.min(100, (settings.spentTodayUsd / Math.max(1, dailySpendLimit)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Policy 4: Slippage Cap */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Max Slippage Tolerance</strong>
                  <span>Max allowable price impact on Aerodrome Slipstream V3 pools. Quotes exceeding this are rejected.</span>
                </div>
                <div className={styles.presetGroup}>
                  {[25, 50, 100].map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      onClick={() => setMaxSlippageBps(bps)}
                      className={`${styles.presetPill} ${maxSlippageBps === bps ? styles.presetPillActive : ""}`}
                    >
                      {(bps / 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Policy 5: NYSE Market Hours Restriction */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Market Hours Restriction</strong>
                  <span>Restricts B20 tokenized stock trades to US trading hours (9:30 AM–4:00 PM ET) to avoid off-market volatility.</span>
                </div>
                <div className={styles.presetGroup}>
                  <button
                    type="button"
                    onClick={() => setRestrictToMarketHours(true)}
                    className={`${styles.presetPill} ${restrictToMarketHours ? styles.presetPillActive : ""}`}
                  >
                    Enforce Market Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestrictToMarketHours(false)}
                    className={`${styles.presetPill} ${!restrictToMarketHours ? styles.presetPillActive : ""}`}
                  >
                    24/7 Unrestricted
                  </button>
                </div>
              </div>

              {/* Policy 6: Minimum Rebalance Drift Gate */}
              <div className={styles.policyItem}>
                <div className={styles.policyItemHeader}>
                  <strong>Min Rebalance Drift Trigger</strong>
                  <span>Prevents excessive trading churn. Rebalances are blocked unless weights drift by at least this amount.</span>
                </div>
                <div className={styles.presetGroup}>
                  {[100, 200, 300, 500].map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      onClick={() => setMinRebalanceDriftBps(bps)}
                      className={`${styles.presetPill} ${minRebalanceDriftBps === bps ? styles.presetPillActive : ""}`}
                    >
                      {(bps / 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Whitelisted Assets Filter */}
            <div style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid var(--line)" }}>
              <div className={styles.policyItemHeader}>
                <strong>Whitelisted Tradable Assets</strong>
                <span>The agent is strictly blocked from proposing or buying assets not explicitly selected below:</span>
              </div>
              <div className={styles.chipGrid}>
                {ALL_POSSIBLE_ASSETS.map((symbol) => {
                  const isSelected = allowedAssets.includes(symbol);
                  return (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => toggleAsset(symbol)}
                      className={`${styles.assetChip} ${isSelected ? styles.assetChipActive : ""}`}
                    >
                      <span>{isSelected ? "✓" : "+"}</span>
                      <span>{symbol}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Card 3: Recent Agent Proposals */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Agent Staged Proposals &amp; Activity Log</h2>
                <p>
                  Transactions staged by your connected agents awaiting your signature or executed on Base.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAgentData}
                className={styles.btnSecondary}
              >
                Refresh
              </button>
            </div>

            {proposals.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px", color: "var(--muted-ink)", background: "var(--panel-2)", borderRadius: "10px", border: "1px solid var(--line)" }}>
                <p style={{ margin: 0, fontSize: "13px" }}>
                  No agent proposals yet. When your connected agent (Claude or ChatGPT) suggests a trade or rebalance, it will stage here for your review and signature.
                </p>
              </div>
            ) : (
              <div className={styles.proposalList}>
                {proposals.map((prop) => {
                  const isPending = prop.status === "PENDING";
                  const isExecuted = prop.status === "EXECUTED";
                  return (
                    <div
                      key={prop.id}
                      className={`${styles.proposalRow} ${isPending ? styles.proposalRowPending : ""}`}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <span
                            className={
                              isPending
                                ? styles.statusPillPending
                                : isExecuted
                                ? styles.statusPillExecuted
                                : styles.statusPillExpired
                            }
                          >
                            {prop.status}
                          </span>
                          <strong style={{ fontSize: "13px", color: "var(--ink)" }}>
                            {prop.proposalSummary?.title || prop.action}
                          </strong>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: 0 }}>
                          {prop.proposalSummary?.description || `Action: ${prop.action}`}
                        </p>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {prop.proposalSummary?.estimatedUsdValue > 0 && (
                          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                            ${prop.proposalSummary.estimatedUsdValue.toFixed(2)}
                          </span>
                        )}

                        {isPending ? (
                          <a
                            href={prop.signUrl}
                            className={styles.btnPrimary}
                            style={{ textDecoration: "none", height: "30px", fontSize: "11px", padding: "0 12px" }}
                          >
                            Review &amp; Sign
                          </a>
                        ) : isExecuted && prop.executedTxHash ? (
                          <a
                            href={`https://basescan.org/tx/${prop.executedTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: "12px", color: "var(--muted-ink)", textDecoration: "underline" }}
                          >
                            BaseScan ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontVariantNumeric: "tabular-nums" }}>
                            {new Date(prop.expiresAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* MODAL 1: New API Key Generated */}
      {newKeyModal && (
        <div role="dialog" aria-modal="true" className={styles.modalBackdrop}>
          <div className={styles.modalBox} style={{ border: "1px solid #d7ff46" }}>
            <h3 style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
              Agent API Key Generated
            </h3>
            <p style={{ color: "var(--muted-ink)", fontSize: "12px", margin: "0 0 16px", lineHeight: "1.5" }}>
              Copy and safely store this API key now. For your security, <strong>it will not be shown again</strong>.
            </p>

            <div
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                marginBottom: "20px",
              }}
            >
              <code style={{ fontSize: "12px", color: "#d7ff46", fontFamily: "monospace", wordBreak: "break-all" }}>
                {newKeyModal.apiKey}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(newKeyModal.apiKey, "key")}
                className={styles.btnSecondary}
                style={{ height: "30px", fontSize: "11px", padding: "0 10px", whiteSpace: "nowrap" }}
              >
                {copiedKey ? "Copied!" : "Copy"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setNewKeyModal(null)}
              className={styles.btnPrimary}
              style={{ width: "100%" }}
            >
              I have stored my key safely
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Disconnect Confirmation */}
      {showDisconnectModal && (
        <div role="dialog" aria-modal="true" className={styles.modalBackdrop}>
          <div className={styles.modalBox} style={{ border: "1px solid rgba(239, 68, 68, 0.4)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#ff7770", margin: "0 0 6px" }}>
              Disconnect AI Agent?
            </h3>
            <p style={{ color: "var(--muted-ink)", fontSize: "12px", margin: "0 0 20px", lineHeight: "1.5" }}>
              Your agent credentials will be permanently revoked immediately. Any connected Claude, ChatGPT, or Cursor instances will lose access to your account.
            </p>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowDisconnectModal(false)}
                className={styles.btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnectAgent}
                disabled={loading}
                className={styles.btnDanger}
              >
                {loading ? "Disconnecting..." : "Yes, Disconnect Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Connect Modal */}
      {showConnectModal && (
        <WalletConnectModal
          isOpen={showConnectModal}
          onClose={() => setShowConnectModal(false)}
        />
      )}
    </div>
  );
}
