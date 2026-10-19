"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSupportedAssets, type SupportedAssetResponse } from "@/hooks/useBaskets";
import styles from "./StockLogo.module.css";

const FALLBACK_ICON_URL = "/token-fallback.svg";

interface StockLogoProps {
  symbol: string;
  address?: string;
  size?: number;
  className?: string;
  roundedFull?: boolean;
}

function AssetFacts({ asset, symbol, compact = false }: { asset?: SupportedAssetResponse; symbol: string; compact?: boolean }) {
  const compactFields = [
    ["ISIN", asset?.isin],
    ["Coinbase NAV", asset?.coinbaseNavPrice ? `$${asset.coinbaseNavPrice}` : null],
    ["NAV updated", asset?.coinbaseNavPriceUpdatedAt ? new Date(asset.coinbaseNavPriceUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null],
    ["Token", asset?.assetAddress ? `${asset.assetAddress.slice(0, 8)}…${asset.assetAddress.slice(-6)}` : null],
  ];
  const fullFields = [
    ["ISIN", asset?.isin],
    ["Token address", asset?.assetAddress],
    ["Decimals", asset?.decimals],
    ["B20 multiplier", asset?.multiplier],
    ["Coinbase NAV", asset?.coinbaseNavPrice ? `$${asset.coinbaseNavPrice}` : null],
    ["NAV updated", asset?.coinbaseNavPriceUpdatedAt ? new Date(asset.coinbaseNavPriceUpdatedAt).toLocaleString() : null],
    ["First minted", asset?.coinbaseFirstMintDate ? new Date(asset.coinbaseFirstMintDate).toLocaleDateString() : null],
    ["Total supply", asset?.coinbaseTotalSupply],
  ];
  const fields = (compact ? compactFields : fullFields)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined);
  return <div className={styles.facts}>
    <div className={styles.identity}><strong>{asset?.name ?? symbol}</strong><span>{asset?.symbol ?? symbol}</span></div>
    {!compact && asset?.description && <p className={styles.description}>{asset.description}</p>}
    {fields.length > 0 ? <dl className={styles.list}>{fields.map(([label, value]) => <div key={label}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}</dl> : <p className={styles.empty}>Coinbase metadata is unavailable for this token.</p>}
    {!compact && asset?.coinbaseNavPrice && <p className={styles.note}>Coinbase NAV is reference data. Trading prices come from Othelio&apos;s oracle.</p>}
  </div>;
}

function TokenImage({ url, size }: { url: string; size: number }) {
  const [failed, setFailed] = useState(false);
  // Coinbase controls this URL, and the image is already a small icon.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={failed ? FALLBACK_ICON_URL : url} alt="" width={size} height={size} onError={() => setFailed(true)} />;
}

export default function StockLogo({ symbol, address, size = 28, className = "", roundedFull = false }: StockLogoProps) {
  const { data } = useSupportedAssets();
  const asset = data?.data.find((candidate) => address
    ? candidate.assetAddress.toLowerCase() === address.toLowerCase()
    : candidate.symbol?.toLowerCase() === symbol.toLowerCase());
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [theme, setTheme] = useState<CSSProperties>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const iconUrl = asset?.iconUrl ?? FALLBACK_ICON_URL;

  useEffect(() => {
    if (!open || !drawer) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") { event.preventDefault(); closeButtonRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [open, drawer]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const captureTheme = (element: HTMLElement) => {
    const computed = getComputedStyle(element);
    setTheme(Object.fromEntries(["--panel", "--ink", "--muted-ink", "--line", "--accent"]
      .map((name) => [name, computed.getPropertyValue(name)])) as CSSProperties);
  };
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); };

  const showPopover = (element: HTMLElement) => {
    if (window.matchMedia("(max-width: 640px)").matches) return;
    cancelClose();
    captureTheme(element);
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.min(Math.max(12, rect.left + rect.width / 2 - 150), Math.max(12, window.innerWidth - 312)),
      top: rect.bottom + 210 > window.innerHeight ? Math.max(12, rect.top - 190) : rect.bottom + 10,
    });
    setDrawer(false);
    setOpen(true);
  };

  const activate = (element: HTMLElement) => {
    if (window.matchMedia("(max-width: 640px)").matches) {
      captureTheme(element);
      setDrawer(true);
      setOpen(true);
    } else showPopover(element);
  };

  return <>
    <span
      ref={triggerRef}
      role="button"
      tabIndex={0}
      aria-label={`Details for ${asset?.name ?? symbol}`}
      aria-describedby={open && !drawer ? tooltipId : undefined}
      className={`${styles.trigger} ${roundedFull ? styles.round : ""} ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={(event) => showPopover(event.currentTarget)}
      onMouseLeave={() => { if (!drawer) scheduleClose(); }}
      onFocus={(event) => showPopover(event.currentTarget)}
      onBlur={() => { if (!drawer) scheduleClose(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); activate(event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); activate(event.currentTarget);
        }
      }}
    >
      <TokenImage key={iconUrl} url={iconUrl} size={size} />
    </span>
    {open && typeof document !== "undefined" && createPortal(drawer
      ? <div className={styles.mobileLayer} style={theme}>
          <button className={styles.backdrop} type="button" aria-label="Close asset details" onClick={() => setOpen(false)} />
          <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={`${asset?.name ?? symbol} details`}>
            <div className={styles.sheetHeader}><span>Token details</span><button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="Close asset details">×</button></div>
            <AssetFacts asset={asset} symbol={symbol} />
          </section>
        </div>
      : <div id={tooltipId} role="tooltip" className={styles.popover} style={{ ...theme, left: position.left, top: position.top }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <AssetFacts asset={asset} symbol={symbol} compact />
        </div>, document.body)}
  </>;
}
