"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { Dialog } from "@/components/ui/Dialog";
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
    const hour = parseInt(
      parts.find((p) => p.type === "hour")?.value || "0",
      10,
    );
    const minute = parseInt(
      parts.find((p) => p.type === "minute")?.value || "0",
      10,
    );

    const isWeekday = weekday !== "Sat" && weekday !== "Sun";
    const minutesSinceMidnight = hour * 60 + minute;
    // 9:30 AM = 570 mins, 4:00 PM = 960 mins
    return (
      isWeekday && minutesSinceMidnight >= 570 && minutesSinceMidnight < 960
    );
  } catch {
    return false;
  }
}

export default function AgentsPage() {
  const { address, isConnected } = useAccount();
  const { token, isAuthenticated, isAuthenticating, authError, login } =
    useAuth();

  const currentAddress = useRef(address);
  useEffect(() => {
    currentAddress.current = address;
  }, [address]);
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [proposals, setProposals] = useState<AgentProposalItem[]>([]);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(() => checkIsMarketOpen());
  const [isApiOnline, setIsApiOnline] = useState<boolean | null>(null);

  // Guardrails form states
  const [autonomyTier, setAutonomyTier] = useState<"staged" | "advisory">(
    "staged",
  );
  const [maxSpendPerTx, setMaxSpendPerTx] = useState<number>(500);
  const [dailySpendLimit, setDailySpendLimit] = useState<number>(2000);
  const [maxSlippageBps, setMaxSlippageBps] = useState<number>(50);
  const [restrictToMarketHours, setRestrictToMarketHours] =
    useState<boolean>(true);
  const [minRebalanceDriftBps, setMinRebalanceDriftBps] = useState<number>(300);
  const [allowedAssets, setAllowedAssets] =
    useState<string[]>(ALL_POSSIBLE_ASSETS);

  // Modals & interaction states
  const [newKeyModal, setNewKeyModal] = useState<{ apiKey: string } | null>(
    null,
  );
  const [showDisconnectModal, setShowDisconnectModal] =
    useState<boolean>(false);
  const [activeSetupTab, setActiveSetupTab] = useState<
    "claude" | "cursor" | "chatgpt" | "curl"
  >("claude");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [savingPermissions, setSavingPermissions] = useState<boolean>(false);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
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
    setLoadError(null);
    try {
      const lowerAddr = address.toLowerCase();
      const [settingsRes, proposalsRes] = await Promise.all([
        fetchAgentSettingsApi(lowerAddr),
        fetchAgentProposalsApi(lowerAddr),
      ]);

      if (currentAddress.current !== address) return;
      if (settingsRes?.data) {
        const s = settingsRes.data;
        setSettings(s);
        setAutonomyTier(s.autonomyTier || "staged");
        setMaxSpendPerTx(s.maxSpendPerTxUsd ?? 500);
        setDailySpendLimit(s.dailySpendLimitUsd ?? 2000);
        setMaxSlippageBps(s.maxSlippageBps ?? 50);
        setRestrictToMarketHours(s.restrictToMarketHours ?? true);
        setMinRebalanceDriftBps(s.minRebalanceDriftBps ?? 300);
        setAllowedAssets(s.allowedAssets || ALL_POSSIBLE_ASSETS);
      }

      if (proposalsRes?.data) {
        setProposals(proposalsRes.data);
      }
    } catch (err) {
      setLoadError(
        "Agent settings and proposals could not be loaded. Try refreshing.",
      );
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setSettings(null);
    setProposals([]);
    setLoadError(null);
    setNewKeyModal(null);
    if (address && isAuthenticated) {
      loadAgentData();
    }
  }, [address, isAuthenticated, loadAgentData]);

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
      const errorMsg =
        err instanceof Error ? err.message : "Failed to generate agent key.";
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
      const errorMsg =
        err instanceof Error ? err.message : "Failed to disconnect agent.";
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
    if (
      ![
        maxSpendPerTx,
        dailySpendLimit,
        maxSlippageBps,
        minRebalanceDriftBps,
      ].every(Number.isFinite) ||
      maxSpendPerTx < 0 ||
      dailySpendLimit < 0
    ) {
      triggerToast("Enter valid non-negative spending limits.");
      return;
    }
    if (dailySpendLimit < maxSpendPerTx) {
      triggerToast(
        "Daily spend budget cannot be less than per-transaction ceiling.",
      );
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
      triggerToast("Agent permissions saved.");
      await loadAgentData();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to update guardrails.";
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

  const copyToClipboard = async (text: string, type: "key" | "snippet") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "key") {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedSnippet(true);
        setTimeout(() => setCopiedSnippet(false), 2000);
      }
      triggerToast("Copied to clipboard.");
    } catch {
      triggerToast("Could not copy. Select the text and copy it manually.");
    }
  };

  const claudeConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        othelio: {
          command: "npx",
          args: ["-y", "@othelio/mcp"],
          env: {
            OTHELIO_API_URL: API_BASE_URL,
            OTHELIO_AGENT_KEY: "YOUR_AGENT_KEY_HERE",
          },
        },
      },
    },
    null,
    2,
  );

  const snippets = {
    claude: claudeConfigSnippet,
    cursor: `Name: othelio\nType: command\nCommand: npx -y @othelio/mcp\nEnvironment:\n  OTHELIO_API_URL=${API_BASE_URL}\n  OTHELIO_AGENT_KEY=YOUR_AGENT_KEY_HERE`,
    chatgpt: `Schema URL: ${API_BASE_URL}/reference/openapi.json\nAuthentication: API Key\nHeader Name: X-Agent-Key`,
    curl: `curl -X GET "${API_BASE_URL}/v1/agent/baskets" -H "X-Agent-Key: YOUR_AGENT_KEY_HERE"`,
  };
  const clients = [
    { id: "claude", name: "Claude Desktop" },
    { id: "cursor", name: "Cursor" },
    { id: "chatgpt", name: "ChatGPT" },
    { id: "curl", name: "REST / cURL" },
  ] as const;
  const pending = proposals.filter((p) => p.status === "PENDING").length;
  const setup = (
    <div className={styles.setup}>
      <h3>Choose your client</h3>
      <div className={styles.choices} role="group" aria-label="Agent client">
        {clients.map((client) => (
          <button
            key={client.id}
            aria-pressed={activeSetupTab === client.id}
            onClick={() => {
              setActiveSetupTab(client.id);
              setCopiedSnippet(false);
            }}
          >
            {client.name}
          </button>
        ))}
      </div>
      {!settings?.hasApiKey ? (
        <>
          <p>
            Create an API key for your client, then add the connection
            configuration. Every transaction still needs your wallet signature.
          </p>
          <button
            className="ui-button"
            disabled={loading || !!loadError}
            onClick={handleConnectAgent}
          >
            {loading ? "Loading…" : "Generate agent key"}
          </button>
        </>
      ) : (
        <>
          <p>
            {activeSetupTab === "claude"
              ? "Add this to your Claude Desktop configuration file."
              : activeSetupTab === "cursor"
                ? "Add an MCP server in Cursor settings with this command and environment."
                : activeSetupTab === "chatgpt"
                  ? "Import this schema in your custom GPT’s Actions settings, then configure API key authentication."
                  : "Use this read-only request to inspect your baskets."}{" "}
            Replace YOUR_AGENT_KEY_HERE with the key you saved.
          </p>
          <div className={styles.code}>
            <pre>{snippets[activeSetupTab]}</pre>
            <button
              className="ui-button"
              data-variant="secondary"
              onClick={() =>
                copyToClipboard(snippets[activeSetupTab], "snippet")
              }
            >
              {copiedSnippet ? "Copied" : "Copy configuration"}
            </button>
          </div>
          <p className={styles.help}>
            A generated key grants access; it does not verify that a client is
            connected.
          </p>
        </>
      )}
    </div>
  );

  return (
    <section className={`app-page-frame ${styles.container}`}>
      <header className="ui-page-header">
        <div>
          <h1>Agents</h1>
          <p>Your agent proposes. You stay in control.</p>
        </div>
        {settings?.hasApiKey && isAuthenticated && (
          <span className={styles.status}>API access enabled</span>
        )}
      </header>
      {authError && (
        <p className="ui-notice" data-tone="error" role="alert">
          {authError}
        </p>
      )}
      {toastMessage && (
        <p className="ui-notice" role="status">
          {toastMessage}
        </p>
      )}
      {!isConnected || !isAuthenticated ? (
        <div className={`ui-state ${styles.gate}`}>
          <h2>
            {isConnected ? "Verify your wallet" : "Connect your first agent"}
          </h2>
          <p>
            Let Claude, Cursor, ChatGPT, or your own client inspect your
            portfolio and prepare proposals within limits you set. Transactions
            require your wallet signature.
          </p>
          <button
            className="ui-button"
            disabled={isAuthenticating}
            onClick={() =>
              isConnected ? void login() : setShowConnectModal(true)
            }
          >
            {isAuthenticating
              ? "Waiting for signature…"
              : isConnected
                ? "Sign in with wallet"
                : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="ui-notice" data-tone="error" role="alert">
              {loadError}{" "}
              <button
                className="ui-button"
                data-variant="secondary"
                onClick={loadAgentData}
              >
                Retry
              </button>
            </div>
          )}
          {loading && !settings && (
            <p className="ui-state" role="status">
              Loading your agent workspace…
            </p>
          )}
          {settings?.hasApiKey && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>
                    Proposals{" "}
                    {pending > 0 && (
                      <span className={styles.count}>{pending} to review</span>
                    )}
                  </h2>
                  <p>
                    Review the details before authorizing anything with your
                    wallet.
                  </p>
                </div>
                <button
                  className="ui-button"
                  data-variant="secondary"
                  disabled={loading}
                  onClick={loadAgentData}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {!proposals.length ? (
                <div className={styles.empty}>
                  <h3>No proposals yet</h3>
                  <p>
                    Ask your connected client to inspect a basket or suggest a
                    rebalance. Staged proposals will appear here.
                  </p>
                </div>
              ) : (
                <div>
                  {[...proposals]
                    .sort(
                      (a, b) =>
                        Number(b.status === "PENDING") -
                        Number(a.status === "PENDING"),
                    )
                    .map((proposal) => (
                      <article className={styles.proposal} key={proposal.id}>
                        <div>
                          <span
                            className={styles.proposalStatus}
                            data-pending={proposal.status === "PENDING"}
                          >
                            {proposal.status}
                          </span>
                          <h3>
                            {proposal.proposalSummary?.title || proposal.action}
                          </h3>
                          <p>
                            {proposal.proposalSummary?.description ||
                              `Action: ${proposal.action}`}
                          </p>
                        </div>
                        <div className={styles.proposalAction}>
                          {proposal.proposalSummary?.estimatedUsdValue > 0 && (
                            <strong>
                              $
                              {proposal.proposalSummary.estimatedUsdValue.toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </strong>
                          )}
                          {proposal.status === "PENDING" ? (
                            <a className="ui-button" href={proposal.signUrl}>
                              Review & sign
                            </a>
                          ) : proposal.status === "EXECUTED" &&
                            proposal.executedTxHash ? (
                            <a
                              href={`https://basescan.org/tx/${proposal.executedTxHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View transaction
                            </a>
                          ) : (
                            <span className={styles.help}>
                              Expires{" "}
                              {new Date(proposal.expiresAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                </div>
              )}
            </section>
          )}
          {!settings?.hasApiKey && !loading && !loadError && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>Connect a client</h2>
                  <p>
                    Generate credentials, configure your client, then review its
                    proposals here.
                  </p>
                </div>
              </div>
              {setup}
            </section>
          )}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Permissions & limits</h2>
                <p>
                  These limits apply to agent requests. Changes take effect when
                  you save.
                </p>
              </div>
            </div>
            <fieldset
              disabled={loading || savingPermissions || !!loadError}
              className={styles.form}
            >
              <div className={styles.mode}>
                <h3>What can your agent do?</h3>
                <div className={styles.modeOptions}>
                  {(
                    [
                      {
                        value: "advisory",
                        title: "Read & advise",
                        description:
                          "Inspect the portfolio and provide read-only intelligence.",
                      },
                      {
                        value: "staged",
                        title: "Prepare proposals",
                        description:
                          "Stage transactions for your review and wallet signature.",
                      },
                    ] as const
                  ).map((mode) => (
                    <label key={mode.value}>
                      <input
                        type="radio"
                        name="agent-mode"
                        checked={autonomyTier === mode.value}
                        onChange={() => setAutonomyTier(mode.value)}
                      />
                      <span>
                        <strong>{mode.title}</strong>
                        <small>{mode.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.budgets}>
                <label className={styles.budget}>
                  <span>Per-transaction limit</span>
                  <strong>${maxSpendPerTx.toLocaleString()}</strong>
                  <input
                    aria-label="Per-transaction limit"
                    type="range"
                    min="100"
                    max={Math.max(2000, maxSpendPerTx)}
                    step="50"
                    value={maxSpendPerTx}
                    onChange={(e) => setMaxSpendPerTx(Number(e.target.value))}
                  />
                  <span className={styles.rangeEnds}>
                    <span>$100</span>
                    <span>
                      ${Math.max(2000, maxSpendPerTx).toLocaleString()}
                    </span>
                  </span>
                </label>
                <label className={styles.budget}>
                  <span>Daily spend limit</span>
                  <strong>${dailySpendLimit.toLocaleString()}</strong>
                  <input
                    aria-label="Daily spend limit"
                    type="range"
                    min="500"
                    max={Math.max(10000, dailySpendLimit)}
                    step="100"
                    value={dailySpendLimit}
                    onChange={(e) => setDailySpendLimit(Number(e.target.value))}
                  />
                  <span className={styles.rangeEnds}>
                    <span>$500</span>
                    <span>
                      ${Math.max(10000, dailySpendLimit).toLocaleString()}
                    </span>
                  </span>
                </label>
              </div>
              {settings && (
                <p className={styles.help}>
                  Reported spend today:{" "}
                  <strong>${settings.spentTodayUsd.toFixed(2)}</strong>
                </p>
              )}
              {dailySpendLimit < maxSpendPerTx && (
                <p className="ui-notice" data-tone="error">
                  Your daily limit must be at least your per-transaction limit.
                </p>
              )}
              <div className={styles.assets}>
                <h3>Allowed assets</h3>
                <p>
                  Select the assets your agent may propose. Keep at least one
                  selected.
                </p>
                <div className={styles.choices}>
                  {ALL_POSSIBLE_ASSETS.map((symbol) => (
                    <button
                      type="button"
                      key={symbol}
                      aria-pressed={allowedAssets.includes(symbol)}
                      onClick={() => toggleAsset(symbol)}
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>
              <details className={styles.details}>
                <summary>Advanced trading limits</summary>
                <div className={styles.advanced}>
                  <label>
                    Maximum slippage
                    <select
                      className="ui-field"
                      value={maxSlippageBps}
                      onChange={(e) =>
                        setMaxSlippageBps(Number(e.target.value))
                      }
                    >
                      {[25, 50, 100].map((value) => (
                        <option value={value} key={value}>
                          {value / 100}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Minimum rebalance drift
                    <select
                      className="ui-field"
                      value={minRebalanceDriftBps}
                      onChange={(e) =>
                        setMinRebalanceDriftBps(Number(e.target.value))
                      }
                    >
                      {[100, 200, 300, 500].map((value) => (
                        <option value={value} key={value}>
                          {value / 100}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={restrictToMarketHours}
                      onChange={(e) =>
                        setRestrictToMarketHours(e.target.checked)
                      }
                    />
                    Restrict trades to US market hours (9:30 AM–4 PM ET)
                  </label>
                </div>
              </details>
              <div className={styles.save}>
                <p>Agents never receive your wallet’s private key.</p>
                <button
                  className="ui-button"
                  disabled={
                    savingPermissions || dailySpendLimit < maxSpendPerTx
                  }
                  onClick={handleSavePermissions}
                >
                  {savingPermissions
                    ? "Saving permissions…"
                    : "Save permissions"}
                </button>
              </div>
            </fieldset>
          </section>
          {settings?.hasApiKey && (
            <details className={styles.details}>
              <summary>Client setup & API access</summary>
              {setup}
              <div className={styles.credentials}>
                <div>
                  <span className={styles.help}>Key identifier</span>
                  <code>{settings.maskedApiKey || "Unavailable"}</code>
                </div>
                <div className={styles.actions}>
                  <button
                    className="ui-button"
                    data-variant="secondary"
                    disabled={loading}
                    onClick={() => setShowRotateModal(true)}
                  >
                    Rotate key
                  </button>
                  <button
                    className="ui-button"
                    data-variant="danger"
                    disabled={loading}
                    onClick={() => setShowDisconnectModal(true)}
                  >
                    Revoke access
                  </button>
                </div>
              </div>
            </details>
          )}
        </>
      )}
      <details className={styles.details}>
        <summary>Service details & developer reference</summary>
        <div className={styles.service}>
          <p>
            API:{" "}
            {isApiOnline === true
              ? "Online"
              : isApiOnline === false
                ? "Unavailable"
                : "Checking…"}
          </p>
          <p>
            US weekday trading window: {isMarketOpen ? "Open" : "Closed"}{" "}
            (holiday schedule not included)
          </p>
          <a
            href={`${API_BASE_URL}/reference`}
            target="_blank"
            rel="noreferrer"
          >
            Open API reference
          </a>
        </div>
      </details>
      <Dialog
        open={!!newKeyModal}
        onClose={() => setNewKeyModal(null)}
        title="Save your agent API key"
        description="Copy and store this key securely. It will not be shown again."
        footer={
          <button className="ui-button" onClick={() => setNewKeyModal(null)}>
            I have saved my key
          </button>
        }
      >
        <div className={styles.secret}>
          <code>{newKeyModal?.apiKey}</code>
          <button
            className="ui-button"
            data-variant="secondary"
            onClick={() =>
              newKeyModal && copyToClipboard(newKeyModal.apiKey, "key")
            }
          >
            {copiedKey ? "Copied" : "Copy key"}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={showDisconnectModal}
        onClose={() => !loading && setShowDisconnectModal(false)}
        title="Revoke agent access?"
        description="Your key will stop working immediately. All clients using it will lose access."
        footer={
          <>
            <button
              className="ui-button"
              data-variant="secondary"
              disabled={loading}
              onClick={() => setShowDisconnectModal(false)}
            >
              Cancel
            </button>
            <button
              className="ui-button"
              data-variant="danger"
              disabled={loading}
              onClick={handleDisconnectAgent}
            >
              {loading ? "Revoking…" : "Revoke access"}
            </button>
          </>
        }
      >
        <p>You can generate a new key later.</p>
      </Dialog>
      <Dialog
        open={showRotateModal}
        onClose={() => setShowRotateModal(false)}
        title="Replace your API key?"
        description="Clients using your current key will lose access. Update them with the new key after rotation."
        footer={
          <>
            <button
              className="ui-button"
              data-variant="secondary"
              onClick={() => setShowRotateModal(false)}
            >
              Cancel
            </button>
            <button
              className="ui-button"
              onClick={() => {
                setShowRotateModal(false);
                void handleConnectAgent();
              }}
            >
              Rotate key
            </button>
          </>
        }
      >
        <p>Save the new key when it appears.</p>
      </Dialog>
      <WalletConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
      />
    </section>
  );
}
