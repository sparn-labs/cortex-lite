use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub content: String,
    pub hash: String,
    pub timestamp: f64,
    pub score: f64,
    pub ttl: f64,
    pub state: String,
    pub access_count: u32,
    pub tags: Vec<String>,
    pub is_btsp: bool,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneResult {
    pub kept: Vec<MemoryEntry>,
    pub removed: Vec<MemoryEntry>,
    pub original_tokens: u32,
    pub pruned_tokens: u32,
    pub budget_utilization: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidateResult {
    pub kept: Vec<MemoryEntry>,
    pub removed: Vec<MemoryEntry>,
    pub entries_before: u32,
    pub entries_after: u32,
    pub decayed_removed: u32,
    pub duplicates_removed: u32,
    pub compression_ratio: f64,
    pub duration_ms: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Token budget for optimization
    pub token_budget: Option<u32>,
    /// Default TTL in hours
    pub default_ttl: Option<f64>,
    /// Decay threshold (0.0-1.0)
    pub decay_threshold: Option<f64>,
    /// Active state threshold
    pub active_threshold: Option<f64>,
    /// Ready state threshold
    pub ready_threshold: Option<f64>,
    /// Full re-optimization interval
    pub full_optimization_interval: Option<u32>,
    /// Recency boost window in minutes
    pub recency_boost_minutes: Option<f64>,
    /// Recency boost multiplier
    pub recency_boost_multiplier: Option<f64>,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct EngineStats {
    pub cached_entries: u32,
    pub unique_terms: u32,
    pub total_documents: u32,
    pub update_count: u32,
}
