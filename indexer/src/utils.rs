use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, U64};
use std::time::Duration;

pub const BASE_FORK_CHAIN_ID: i64 = 31337;
pub const BASE_MAINNET_CHAIN_ID: i64 = 8453;
pub const MULTICALL3_ADDRESS: &str = "0xca11bde05977b3631167028862be2a173976ca11";

#[inline]
pub fn fmt_addr(addr: &Address) -> String {
    format!("{:#x}", addr).to_lowercase()
}

pub fn configured_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

pub fn lease_owner(worker: &str) -> String {
    std::env::var("INDEXER_LEASE_OWNER")
        .unwrap_or_else(|_| format!("{}:{}", std::process::id(), worker))
}

pub fn lease_duration_secs() -> i64 {
    let timeout = configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30);
    configured_u64(
        "INDEXER_LEASE_SECS",
        timeout.saturating_mul(3).saturating_add(60),
    )
    .max(timeout + 30) as i64
}

pub fn circuit_key(worker: &str, secondary: bool) -> String {
    format!(
        "{}:{}",
        worker,
        if secondary { "secondary" } else { "primary" }
    )
}

pub fn provider_name(secondary: bool) -> &'static str {
    if secondary {
        "secondary"
    } else {
        "primary"
    }
}

#[derive(Default)]
pub struct RpcHealth {
    pub consecutive_failures: u32,
    pub circuit_open_until: Option<std::time::Instant>,
}

impl RpcHealth {
    pub fn can_request(&self) -> bool {
        self.circuit_open_until
            .map_or(true, |until| until <= std::time::Instant::now())
    }

    pub fn success(&mut self) {
        self.consecutive_failures = 0;
        self.circuit_open_until = None;
    }

    pub fn failure(&mut self) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        let threshold = configured_u64("INDEXER_RPC_CIRCUIT_FAILURES", 3) as u32;
        if self.consecutive_failures >= threshold {
            self.circuit_open_until = Some(
                std::time::Instant::now()
                    + Duration::from_secs(configured_u64("INDEXER_RPC_CIRCUIT_COOLDOWN_SECS", 30)),
            );
        }
    }
}

pub fn is_supported_chain_id(chain_id: i64) -> bool {
    matches!(chain_id, BASE_FORK_CHAIN_ID | BASE_MAINNET_CHAIN_ID)
}

pub fn rpc_backoff_delay(failure_count: u32) -> Duration {
    let exponent = failure_count.saturating_sub(1).min(6);
    Duration::from_secs((1_u64 << exponent).min(60))
}

pub fn rpc_retry_delay(failure_count: u32) -> Duration {
    let base = rpc_backoff_delay(failure_count).as_millis() as u64;
    let jitter = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis() as u64)
        % (base / 4 + 1);
    Duration::from_millis(base.saturating_add(jitter))
}

pub async fn read_head(provider: &Provider<Http>) -> Result<U64, Box<dyn std::error::Error>> {
    let timeout = Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
    Ok(tokio::time::timeout(timeout, provider.get_block_number()).await??)
}

pub fn nav_micro_to_numeric_string(value: U256) -> String {
    let main = value / U256::from(1_000_000u64);
    let rem = value % U256::from(1_000_000u64);
    format!("{}.{:06}", main, rem)
}

#[cfg(test)]
mod network_tests {
    use super::{
        is_supported_chain_id, rpc_backoff_delay, BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID,
    };
    use std::time::Duration;

    #[test]
    fn supports_only_base_fork_and_base_mainnet() {
        assert!(is_supported_chain_id(BASE_FORK_CHAIN_ID));
        assert!(is_supported_chain_id(BASE_MAINNET_CHAIN_ID));
        assert!(!is_supported_chain_id(84532));
    }

    #[test]
    fn rpc_backoff_is_exponential_and_capped() {
        assert_eq!(rpc_backoff_delay(1), Duration::from_secs(1));
        assert_eq!(rpc_backoff_delay(2), Duration::from_secs(2));
        assert_eq!(rpc_backoff_delay(3), Duration::from_secs(4));
        assert_eq!(rpc_backoff_delay(7), Duration::from_secs(60));
        assert_eq!(rpc_backoff_delay(100), Duration::from_secs(60));
    }
}
