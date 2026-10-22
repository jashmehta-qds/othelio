"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import {
  fetchAgentSettingsApi,
  updateAgentSettingsApi,
  generateAgentApiKeyApi,
  revokeAgentApiKeyApi,
  fetchAgentProposalsApi,
  type AgentSettings,
  type AgentProposalItem,
} from "@/lib/api";

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

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { token, isAuthenticated, isAuthenticating, authError, login } = useAuth();

  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [proposals, setProposals] = useState<AgentProposalItem[]>([]);

  // Form states for permissions/guardrails
  const [autonomyTier, setAutonomyTier] = useState<"staged" | "advisory">("staged");
  const [maxSpendPerTx, setMaxSpendPerTx] = useState<number>(500);
  const [dailySpendLimit, setDailySpendLimit] = useState<number>(2000);
  const [maxSlippageBps, setMaxSlippageBps] = useState<number>(50);
  const [restrictToMarketHours, setRestrictToMarketHours] = useState<boolean>(true);
  const [minRebalanceDriftBps, setMinRebalanceDriftBps] = useState<number>(300);
  const [allowedAssets, setAllowedAssets] = useState<string[]>(ALL_POSSIBLE_ASSETS);

  // Modals & toasts
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

  // Load agent data once wallet & auth token are ready
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

  // Handle generating / connecting agent API key
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
        triggerToast("Agent connected! Save your API key.");
      }
    } catch (err: any) {
      console.error("Generate key error:", err);
      triggerToast(err.message || "Failed to generate agent key.");
    } finally {
      setLoading(false);
    }
  };

  // Handle disconnecting agent (revoking key)
  const handleDisconnectAgent = async () => {
    if (!address || !token) return;
    setLoading(true);
    try {
      await revokeAgentApiKeyApi(address, token);
      setShowDisconnectModal(false);
      await loadAgentData();
      triggerToast("Agent disconnected successfully.");
    } catch (err: any) {
      console.error("Revoke key error:", err);
      triggerToast(err.message || "Failed to disconnect agent.");
    } finally {
      setLoading(false);
    }
  };

  // Handle saving permissions/guardrails
  const handleSavePermissions = async () => {
    if (!address || !token) {
      triggerToast("Wallet authentication required to update guardrails.");
      return;
    }
    if (dailySpendLimit < maxSpendPerTx) {
      triggerToast("Daily spend limit cannot be less than per-transaction limit.");
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
      triggerToast("Agent permissions and guardrails updated.");
      await loadAgentData();
    } catch (err: any) {
      console.error("Update permissions error:", err);
      triggerToast(err.message || "Failed to update permissions.");
    } finally {
      setSavingPermissions(false);
    }
  };

  const toggleAsset = (symbol: string) => {
    if (allowedAssets.includes(symbol)) {
      if (allowedAssets.length <= 1) {
        triggerToast("At least one asset must be allowed.");
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
    triggerToast("Copied to clipboard!");
  };

  const currentBackendUrl = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001";

  const claudeConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        othelio: {
          command: "npx",
          args: ["-y", "@othelio/mcp"],
          env: {
            OTHELIO_API_URL: currentBackendUrl,
            OTHELIO_AGENT_KEY: settings?.maskedApiKey || "YOUR_AGENT_KEY_HERE",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <section className="app-page-frame" style={{ maxWidth: "1080px", margin: "0 auto", padding: "28px 20px" }}>
      {/* Toast Notification */}
      {toastMessage && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "32px",
            right: "32px",
            background: "#161814",
            border: "1px solid #d7ff46",
            color: "#d7ff46",
            padding: "12px 20px",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: 600,
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#d7ff46" }} />
          {toastMessage}
        </aside>
      )}

      {/* Page Header */}
      <header style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 className="page-title" style={{ fontSize: "28px", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
              Connected Agents
            </h1>
            <p className="page-description" style={{ color: "var(--muted-ink)", fontSize: "14px", marginTop: "6px" }}>
              Connect and govern AI agents (Claude, ChatGPT, Cursor, bots) with strict financial guardrails and human sign-off.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <a
              href={`${currentBackendUrl}/reference`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--muted-ink)",
                textDecoration: "none",
                padding: "8px 14px",
                borderRadius: "10px",
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
              }}
            >
              <span>Scalar API Docs</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
          </div>
        </div>
      </header>

      {/* Wallet / Auth Gate */}
      {!isConnected ? (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "20px",
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <div style={{ width: "48px", height: "48px", margin: "0 auto 16px", color: "var(--muted-ink)" }}>
            <AppIcon type="lock" />
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
            Wallet Not Connected
          </h2>
          <p style={{ color: "var(--muted-ink)", fontSize: "14px", maxWidth: "420px", margin: "0 auto 24px" }}>
            Connect your Web3 wallet to inspect your connected AI agents, manage execution permissions, or configure limits.
          </p>
          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            style={{
              background: "#d7ff46",
              color: "#10110f",
              fontWeight: 700,
              fontSize: "14px",
              padding: "12px 28px",
              borderRadius: "12px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Connect Wallet
          </button>
        </div>
      ) : !isAuthenticated ? (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "20px",
            padding: "36px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>
              Sign In to Manage Agent Permissions
            </h2>
            <p style={{ color: "var(--muted-ink)", fontSize: "13px", margin: 0 }}>
              Verify ownership of {address?.slice(0, 6)}...{address?.slice(-4)} via a gasless cryptographic signature.
            </p>
          </div>
          <button
            type="button"
            onClick={() => login()}
            disabled={isAuthenticating}
            style={{
              background: "#d7ff46",
              color: "#10110f",
              fontWeight: 700,
              fontSize: "13px",
              padding: "10px 22px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
            }}
          >
            {isAuthenticating ? "Verifying..." : "Sign In with Wallet"}
          </button>
        </div>
      ) : null}

      {/* Main Agent Interface (when wallet connected) */}
      {isConnected && (
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          {/* Card 1: Connection Status & Identity */}
          <section
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "20px",
              padding: "28px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            {settings?.hasApiKey ? (
              /* CONNECTED STATE */
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          textTransform: "uppercase",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          background: "rgba(215, 255, 70, 0.12)",
                          color: "#d7ff46",
                          border: "1px solid rgba(215, 255, 70, 0.3)",
                        }}
                      >
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d7ff46", display: "inline-block" }} />
                        Active Agent Connected
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>
                        Updated {new Date(settings.updatedAt || Date.now()).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
                      Agent Access Credentials
                    </h2>
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={handleConnectAgent}
                      disabled={loading}
                      style={{
                        background: "var(--panel-2)",
                        border: "1px solid var(--line)",
                        color: "var(--ink)",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "8px 16px",
                        borderRadius: "10px",
                        cursor: "pointer",
                      }}
                    >
                      Rotate Key
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDisconnectModal(true)}
                      disabled={loading}
                      style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#ff7770",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "8px 16px",
                        borderRadius: "10px",
                        cursor: "pointer",
                      }}
                    >
                      Disconnect Agent
                    </button>
                  </div>
                </div>

                {/* Masked Key Display */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "12px 16px",
                    marginBottom: "24px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: "var(--muted-ink)", fontWeight: 600 }}>API KEY:</span>
                    <code style={{ fontSize: "13px", color: "var(--ink)", fontFamily: "monospace", letterSpacing: "1px" }}>
                      {settings.maskedApiKey || "oth_ag••••••••••••"}
                    </code>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--muted-ink)" }}>
                    Stored securely as SHA-256 hash
                  </span>
                </div>

                {/* Setup Instructions for Agent Runtimes */}
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: "20px" }}>
                  <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 12px" }}>
                    How to Connect Your Agent
                  </h3>

                  <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                    {[
                      { id: "claude", label: "Claude Desktop" },
                      { id: "cursor", label: "Cursor IDE" },
                      { id: "chatgpt", label: "ChatGPT Action" },
                      { id: "curl", label: "cURL / Python" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveSetupTab(tab.id as any)}
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "6px 14px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          border: activeSetupTab === tab.id ? "1px solid #d7ff46" : "1px solid var(--line)",
                          background: activeSetupTab === tab.id ? "rgba(215, 255, 70, 0.12)" : "var(--panel-2)",
                          color: activeSetupTab === tab.id ? "#d7ff46" : "var(--muted-ink)",
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activeSetupTab === "claude" && (
                    <div style={{ background: "#0b0c0a", borderRadius: "10px", padding: "16px", border: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted-ink)" }}>Add to ~/Library/Application Support/Claude/claude_desktop_config.json</span>
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
                          {copiedSnippet ? "Copied!" : "Copy Snippet"}
                        </button>
                      </div>
                      <pre style={{ margin: 0, fontSize: "12px", color: "#a5b4fc", fontFamily: "monospace", overflowX: "auto" }}>
                        {claudeConfigSnippet}
                      </pre>
                    </div>
                  )}

                  {activeSetupTab === "cursor" && (
                    <div style={{ background: "#0b0c0a", borderRadius: "10px", padding: "16px", border: "1px solid var(--line)" }}>
                      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--ink)" }}>
                        In Cursor, go to <strong>Settings &gt; Features &gt; MCP Servers</strong>, and add:
                      </p>
                      <pre style={{ margin: 0, fontSize: "12px", color: "#a5b4fc", fontFamily: "monospace", overflowX: "auto" }}>
{`Name: othelio
Type: command
Command: npx -y @othelio/mcp
Environment:
  OTHELIO_API_URL=${currentBackendUrl}
  OTHELIO_AGENT_KEY=${settings.maskedApiKey || "YOUR_KEY"}`}
                      </pre>
                    </div>
                  )}

                  {activeSetupTab === "chatgpt" && (
                    <div style={{ background: "#0b0c0a", borderRadius: "10px", padding: "16px", border: "1px solid var(--line)" }}>
                      <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--ink)" }}>
                        When creating a Custom GPT in OpenAI, select <strong>Add Action &gt; Import from URL</strong>:
                      </p>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <code style={{ background: "var(--panel-2)", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", color: "#d7ff46", flex: 1 }}>
                          {`${currentBackendUrl}/reference/openapi.json`}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`${currentBackendUrl}/reference/openapi.json`, "snippet")}
                          style={{ fontSize: "11px", fontWeight: 600, padding: "6px 12px", borderRadius: "6px", background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", cursor: "pointer" }}
                        >
                          Copy URL
                        </button>
                      </div>
                      <p style={{ margin: "10px 0 0", fontSize: "11px", color: "var(--muted-ink)" }}>
                        Under Authentication, choose <strong>API Key</strong> with Header name <code>X-Agent-Key</code>.
                      </p>
                    </div>
                  )}

                  {activeSetupTab === "curl" && (
                    <div style={{ background: "#0b0c0a", borderRadius: "10px", padding: "16px", border: "1px solid var(--line)" }}>
                      <pre style={{ margin: 0, fontSize: "12px", color: "#a5b4fc", fontFamily: "monospace", overflowX: "auto" }}>
{`curl -X GET "${currentBackendUrl}/v1/agent/baskets" \\
  -H "X-Agent-Key: YOUR_AGENT_KEY"`}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* DISCONNECTED STATE */
              <div style={{ textAlign: "center", padding: "20px 10px" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "rgba(215, 255, 70, 0.1)", border: "1px solid rgba(215, 255, 70, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#d7ff46" }}>
                  <AppIcon type="agents" />
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--ink)", margin: "0 0 8px" }}>
                  Connect an AI Agent
                </h2>
                <p style={{ color: "var(--muted-ink)", fontSize: "14px", maxWidth: "520px", margin: "0 auto 24px", lineHeight: "1.5" }}>
                  Authorize Claude, ChatGPT, Cursor, or automated bots to inspect your baskets and stage bounded trades under your strict guardrails.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", maxWidth: "700px", margin: "0 auto 28px", textAlign: "left" }}>
                  <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px" }}>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)", marginBottom: "4px" }}>Non-Custodial</div>
                    <div style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Agents never access private keys. You sign every transaction.</div>
                  </div>
                  <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px" }}>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)", marginBottom: "4px" }}>Hard Guardrails</div>
                    <div style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Enforce per-trade spend limits, daily caps, and allowed tokens.</div>
                  </div>
                  <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "12px", padding: "14px" }}>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)", marginBottom: "4px" }}>Anti-Drain Protection</div>
                    <div style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Withdrawals are cryptographically locked to your wallet only.</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleConnectAgent}
                  disabled={loading}
                  style={{
                    background: "#d7ff46",
                    color: "#10110f",
                    fontWeight: 700,
                    fontSize: "14px",
                    padding: "12px 32px",
                    borderRadius: "12px",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 4px 16px rgba(215, 255, 70, 0.2)",
                  }}
                >
                  {loading ? "Generating Credentials..." : "Connect Agent & Generate Key"}
                </button>
              </div>
            )}
          </section>

          {/* Card 2: Permissions & Financial Guardrails */}
          <section
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "20px",
              padding: "28px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: "0 0 4px" }}>
                  Permissions &amp; Financial Guardrails
                </h2>
                <p style={{ color: "var(--muted-ink)", fontSize: "13px", margin: 0 }}>
                  These rules are strictly enforced server-side before an agent can generate quotes or prepare transactions.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSavePermissions}
                disabled={savingPermissions}
                style={{
                  background: "#d7ff46",
                  color: "#10110f",
                  fontWeight: 700,
                  fontSize: "13px",
                  padding: "9px 20px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                }}
              >
                {savingPermissions ? "Saving..." : "Save Permissions"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Permission 1: Autonomy Mode */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>Execution Autonomy Tier</span>
                    <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 0" }}>
                      Controls whether the agent can stage transactions for your signature or only provide advice.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setAutonomyTier("staged")}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: autonomyTier === "staged" ? "1px solid #d7ff46" : "1px solid var(--line)",
                        background: autonomyTier === "staged" ? "#d7ff46" : "var(--panel-2)",
                        color: autonomyTier === "staged" ? "#10110f" : "var(--ink)",
                      }}
                    >
                      Staged (Human-in-the-Loop)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutonomyTier("advisory")}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: autonomyTier === "advisory" ? "1px solid #d7ff46" : "1px solid var(--line)",
                        background: autonomyTier === "advisory" ? "#d7ff46" : "var(--panel-2)",
                        color: autonomyTier === "advisory" ? "#10110f" : "var(--ink)",
                      }}
                    >
                      Advisory (Read-Only)
                    </button>
                  </div>
                </div>
              </div>

              {/* Permission 2: Max Spend per Transaction */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>Max Spend per Transaction</span>
                    <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 0" }}>
                      Hard ceiling on the USD value of any single deposit, trade, or rebalance proposal.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[100, 250, 500, 1000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMaxSpendPerTx(val)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          border: maxSpendPerTx === val ? "1px solid #d7ff46" : "1px solid var(--line)",
                          background: maxSpendPerTx === val ? "#d7ff46" : "var(--panel-2)",
                          color: maxSpendPerTx === val ? "#10110f" : "var(--ink)",
                        }}
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Permission 3: Daily Spend Limit & Progress */}
              <div style={{ paddingBottom: "20px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>Daily Spend Budget</span>
                    <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 0" }}>
                      Cumulative 24-hour limit across all agent actions. Auto-resets every 24 hours.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[500, 1000, 2000, 5000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDailySpendLimit(val)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          border: dailySpendLimit === val ? "1px solid #d7ff46" : "1px solid var(--line)",
                          background: dailySpendLimit === val ? "#d7ff46" : "var(--panel-2)",
                          color: dailySpendLimit === val ? "#10110f" : "var(--ink)",
                        }}
                      >
                        ${val.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress bar of consumed budget */}
                {settings && (
                  <div style={{ background: "var(--panel-2)", padding: "12px 16px", borderRadius: "10px", border: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                      <span style={{ color: "var(--muted-ink)" }}>Today's Agent Spend:</span>
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                        ${settings.spentTodayUsd.toFixed(2)} / ${dailySpendLimit.toFixed(2)} USD
                      </span>
                    </div>
                    <div style={{ width: "100%", height: "6px", background: "var(--line)", borderRadius: "3px", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(100, (settings.spentTodayUsd / dailySpendLimit) * 100)}%`,
                          height: "100%",
                          background: "#d7ff46",
                          borderRadius: "3px",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Permission 4: Market Hours & Slippage */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", paddingBottom: "20px", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>Max Slippage Tolerance</span>
                  <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 10px" }}>
                    Hard ceiling on DEX swap price impact.
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[25, 50, 100].map((bps) => (
                      <button
                        key={bps}
                        type="button"
                        onClick={() => setMaxSlippageBps(bps)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          border: maxSlippageBps === bps ? "1px solid #d7ff46" : "1px solid var(--line)",
                          background: maxSlippageBps === bps ? "#d7ff46" : "var(--panel-2)",
                          color: maxSlippageBps === bps ? "#10110f" : "var(--ink)",
                        }}
                      >
                        {(bps / 100).toFixed(2)}%
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>NYSE Market Hours Restriction</span>
                  <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 10px" }}>
                    Restricts B20 tokenized stock trades to US market hours (9:30 AM–4:00 PM ET).
                  </p>
                  <button
                    type="button"
                    onClick={() => setRestrictToMarketHours(!restrictToMarketHours)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: restrictToMarketHours ? "1px solid #d7ff46" : "1px solid var(--line)",
                      background: restrictToMarketHours ? "rgba(215, 255, 70, 0.15)" : "var(--panel-2)",
                      color: restrictToMarketHours ? "#d7ff46" : "var(--muted-ink)",
                    }}
                  >
                    {restrictToMarketHours ? "Enforced (Recommended)" : "Disabled (Allow 24/7)"}
                  </button>
                </div>
              </div>

              {/* Permission 5: Asset Whitelist */}
              <div>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>Allowed Assets Whitelist</span>
                <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "2px 0 12px" }}>
                  The agent is strictly prohibited from quoting or allocating into unselected assets. Click to toggle.
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {ALL_POSSIBLE_ASSETS.map((symbol) => {
                    const isSelected = allowedAssets.includes(symbol);
                    return (
                      <button
                        key={symbol}
                        type="button"
                        onClick={() => toggleAsset(symbol)}
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "6px 12px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          border: isSelected ? "1px solid #d7ff46" : "1px solid var(--line)",
                          background: isSelected ? "rgba(215, 255, 70, 0.12)" : "var(--panel-2)",
                          color: isSelected ? "#d7ff46" : "var(--muted-ink)",
                        }}
                      >
                        {isSelected ? "✓ " : "+ "}
                        {symbol}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Card 3: Recent Agent Proposals */}
          <section
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "20px",
              padding: "28px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
                  Recent Agent Proposals &amp; Activity
                </h2>
                <p style={{ color: "var(--muted-ink)", fontSize: "13px", marginTop: "4px" }}>
                  Transactions staged by your connected agents awaiting your signature or executed on Base.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAgentData}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--muted-ink)",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </div>

            {proposals.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px", color: "var(--muted-ink)", background: "var(--panel-2)", borderRadius: "12px", border: "1px solid var(--line)" }}>
                <p style={{ margin: 0, fontSize: "13px" }}>
                  No agent proposals yet. When your AI agent (Claude or ChatGPT) suggests a deposit or rebalance, it will appear here for your approval.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {proposals.map((prop) => {
                  const isPending = prop.status === "PENDING";
                  const isExecuted = prop.status === "EXECUTED";
                  return (
                    <div
                      key={prop.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                        background: "var(--panel-2)",
                        border: isPending ? "1px solid #d7ff46" : "1px solid var(--line)",
                        borderRadius: "12px",
                        padding: "14px 18px",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              background: isPending ? "rgba(215, 255, 70, 0.15)" : isExecuted ? "rgba(34, 197, 94, 0.15)" : "rgba(156, 163, 175, 0.15)",
                              color: isPending ? "#d7ff46" : isExecuted ? "#4ade80" : "var(--muted-ink)",
                            }}
                          >
                            {prop.status}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>
                            {prop.proposalSummary?.title || prop.action}
                          </span>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: 0 }}>
                          {prop.proposalSummary?.description}
                        </p>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {prop.proposalSummary?.estimatedUsdValue > 0 && (
                          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                            ${prop.proposalSummary.estimatedUsdValue.toFixed(2)}
                          </span>
                        )}

                        {isPending ? (
                          <a
                            href={prop.signUrl}
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "#10110f",
                              background: "#d7ff46",
                              padding: "6px 14px",
                              borderRadius: "8px",
                              textDecoration: "none",
                            }}
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
                            View on BaseScan ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>
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
        </div>
      )}

      {/* MODAL 1: New API Key Generated */}
      {newKeyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#121410",
              border: "1px solid #d7ff46",
              borderRadius: "20px",
              padding: "32px",
              maxWidth: "520px",
              width: "100%",
              boxShadow: "0 20px 48px rgba(0,0,0,0.5)",
            }}
          >
            <h3 style={{ fontSize: "20px", fontWeight: 700, color: "var(--ink)", margin: "0 0 8px" }}>
              Agent API Key Generated
            </h3>
            <p style={{ color: "var(--muted-ink)", fontSize: "13px", margin: "0 0 20px", lineHeight: "1.5" }}>
              Please copy and store this API key now. For your security, <strong>it will not be displayed again</strong>.
            </p>

            <div
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                marginBottom: "24px",
              }}
            >
              <code style={{ fontSize: "13px", color: "#d7ff46", fontFamily: "monospace", wordBreak: "break-all" }}>
                {newKeyModal.apiKey}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(newKeyModal.apiKey, "key")}
                style={{
                  background: copiedKey ? "#d7ff46" : "var(--line)",
                  color: copiedKey ? "#10110f" : "var(--ink)",
                  fontWeight: 600,
                  fontSize: "12px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copiedKey ? "Copied!" : "Copy"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setNewKeyModal(null)}
              style={{
                width: "100%",
                background: "#d7ff46",
                color: "#10110f",
                fontWeight: 700,
                fontSize: "14px",
                padding: "12px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
              }}
            >
              I have saved my key
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Disconnect Confirmation */}
      {showDisconnectModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#161814",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: "20px",
              padding: "28px",
              maxWidth: "460px",
              width: "100%",
            }}
          >
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#ff7770", margin: "0 0 8px" }}>
              Disconnect AI Agent?
            </h3>
            <p style={{ color: "var(--muted-ink)", fontSize: "13px", margin: "0 0 20px", lineHeight: "1.5" }}>
              Are you sure you want to disconnect? Your agent's credentials will be permanently revoked immediately, and any running Claude or ChatGPT agents will lose access to your portfolio.
            </p>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowDisconnectModal(false)}
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                  fontSize: "13px",
                  fontWeight: 600,
                  padding: "9px 18px",
                  borderRadius: "10px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnectAgent}
                disabled={loading}
                style={{
                  background: "#ef4444",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  padding: "9px 18px",
                  borderRadius: "10px",
                  cursor: "pointer",
                }}
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
    </section>
  );
}
